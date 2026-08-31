import type { BBox, Lead, ProgressFn } from '../types';
import type { Http, CancelToken } from '../http';
import { toOverpass } from '../bbox';

/**
 * NPPES carries no website and no email. OpenStreetMap carries both for a
 * minority of practices, so this recovers what it can by name.
 *
 * Matching is by name, not distance: the coordinates on an NPPES lead come
 * from its ZIP centroid, which can sit a mile or more from the actual door.
 * Distance would produce confident nonsense.
 */

const ENDPOINT = 'https://overpass-api.de/api/interpreter';

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

export interface OsmPlace {
  name: string;
  normalized: string;
  tokens: Set<string>;
  website: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
}

/** Words that carry no identifying signal in a practice name. */
const STOPWORDS = new Set([
  'the', 'and', 'of', 'at', 'for', 'a', 'an', 'inc', 'llc', 'pllc', 'pc', 'pa',
  'llp', 'lp', 'ltd', 'co', 'corp', 'group', 'associates', 'assoc', 'center',
  'centre', 'clinic', 'office', 'offices', 'practice', 'dr', 'doctor',
]);

export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nameTokens(raw: string): Set<string> {
  return new Set(
    normalizeName(raw)
      .split(' ')
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

/**
 * Jaccard overlap of distinctive tokens. Requires at least one shared token
 * that is not a generic specialty word, so "Smith Family Dentistry" does not
 * match "Jones Family Dentistry" on "family" and "dentistry" alone.
 */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  if (!shared) return 0;
  const union = a.size + b.size - shared;
  return shared / union;
}

const GENERIC = new Set([
  'dental', 'dentistry', 'dentist', 'medical', 'health', 'healthcare',
  'family', 'care', 'chiropractic', 'therapy', 'physical', 'vision', 'eye',
  'smile', 'smiles', 'wellness', 'orthodontics', 'pediatric', 'pediatrics',
]);

function hasDistinctiveOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const t of a) if (b.has(t) && !GENERIC.has(t)) return true;
  return false;
}

/** Pull every named healthcare POI in the box that carries a contact tag. */
export async function fetchOsmPlaces(
  bbox: BBox,
  http: Http,
  cancel?: CancelToken,
): Promise<OsmPlace[]> {
  cancel?.throwIfCancelled();
  const bb = toOverpass(bbox);
  const query = [
    '[out:json][timeout:90];',
    '(',
    `  nwr["name"]["amenity"~"^(clinic|doctors|dentist|hospital|pharmacy)$"](${bb});`,
    `  nwr["name"]["healthcare"](${bb});`,
    `  nwr["name"]["shop"~"^(optician|hearing_aids|medical_supply)$"](${bb});`,
    ');',
    'out center tags;',
  ].join('\n');

  const data = await http.postForm<OverpassResponse>(
    ENDPOINT,
    'data=' + encodeURIComponent(query),
  );

  const out: OsmPlace[] = [];
  for (const el of data.elements ?? []) {
    const t = el.tags ?? {};
    const name = t.name ?? t['name:en'];
    if (!name) continue;

    const website = t.website ?? t['contact:website'] ?? t.url ?? null;
    const email = t.email ?? t['contact:email'] ?? null;
    const phone = t.phone ?? t['contact:phone'] ?? null;
    // A POI with no contact tag cannot enrich anything.
    if (!website && !email && !phone) continue;

    out.push({
      name,
      normalized: normalizeName(name),
      tokens: nameTokens(name),
      website,
      email,
      phone,
      city: t['addr:city'] ?? null,
      lat: el.lat ?? el.center?.lat ?? null,
      lon: el.lon ?? el.center?.lon ?? null,
    });
  }
  return out;
}

export interface OsmMatchResult {
  leads: Lead[];
  osmPlaces: number;
  matched: number;
}

const MIN_SIMILARITY = 0.4;

/**
 * Fold OSM contact tags into leads that lack them. Only fills gaps - a phone
 * number from the federal registry is never overwritten by a crowd-sourced one.
 */
export async function enrichFromOsm(
  leads: Lead[],
  bbox: BBox,
  http: Http,
  onProgress?: ProgressFn,
  cancel?: CancelToken,
): Promise<OsmMatchResult> {
  onProgress?.({
    phase: 'enriching',
    message: 'Looking up websites in OpenStreetMap',
    current: 0,
    total: leads.length,
    leadsFound: leads.length,
  });

  let places: OsmPlace[];
  try {
    places = await fetchOsmPlaces(bbox, http, cancel);
  } catch {
    // Overpass is rate-limited and flaky; enrichment is allowed to fail.
    return { leads, osmPlaces: 0, matched: 0 };
  }

  let matched = 0;
  const out = leads.map((lead, i) => {
    if (lead.website && lead.email) return lead;

    const tokens = nameTokens(lead.practiceName);
    let best: OsmPlace | null = null;
    let bestScore = 0;

    for (const p of places) {
      const s = similarity(tokens, p.tokens);
      if (s > bestScore && s >= MIN_SIMILARITY && hasDistinctiveOverlap(tokens, p.tokens)) {
        best = p;
        bestScore = s;
      }
    }

    if (i % 25 === 0) {
      onProgress?.({
        phase: 'enriching',
        message: 'Matching names against OpenStreetMap',
        current: i,
        total: leads.length,
        leadsFound: leads.length,
      });
    }

    if (!best) return lead;
    matched++;
    return {
      ...lead,
      website: lead.website ?? best.website,
      email: lead.email ?? best.email,
      enrichedAt: new Date().toISOString(),
    };
  });

  return { leads: out, osmPlaces: places.length, matched };
}
