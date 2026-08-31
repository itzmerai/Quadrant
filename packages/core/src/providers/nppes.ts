import type { Lead } from '../types';
import type { RegistryProvider, SearchRequest, SearchResult } from './types';
import { zipsInBBox, type ZipRow } from '../zip/resolver';
import { mapLimit } from '../http';
import { timezoneFor } from '../timezone';
import {
  SPECIALTY_GROUPS,
  groupForTaxonomy,
  isExcludedTaxonomy,
  looksLikeLargeOrg,
  presetKeys,
} from '../taxonomy';
import { scoreLead } from '../score';

const ENDPOINT = 'https://npiregistry.cms.hhs.gov/api/';
const PAGE_SIZE = 200; // API maximum
const MAX_SKIP = 1000; // API maximum -> 1,200 records per unique query
const CONCURRENCY = 4;

/** Raw NPPES shapes. Only the fields we actually consume. */
interface NppesAddress {
  address_purpose?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  telephone_number?: string;
  fax_number?: string;
  country_code?: string;
}

interface NppesTaxonomy {
  code?: string;
  desc?: string;
  primary?: boolean;
  state?: string;
  license?: string;
}

interface NppesBasic {
  organization_name?: string;
  first_name?: string;
  last_name?: string;
  credential?: string;
  sole_proprietor?: string;
  authorized_official_first_name?: string;
  authorized_official_last_name?: string;
  authorized_official_title_or_position?: string;
  authorized_official_telephone_number?: string;
  enumeration_date?: string;
  last_updated?: string;
  status?: string;
}

interface NppesRecord {
  number?: string | number;
  enumeration_type?: string;
  basic?: NppesBasic;
  addresses?: NppesAddress[];
  taxonomies?: NppesTaxonomy[];
}

interface NppesResponse {
  result_count?: number;
  results?: NppesRecord[];
  Errors?: Array<{ description?: string }>;
}

function buildUrl(params: Record<string, string | number>): string {
  const qs = new URLSearchParams({ version: '2.1' });
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  return ENDPOINT + '?' + qs.toString();
}

/** US phone digits -> (480) 998-8073. Left alone if it is not 10 digits. */
function formatPhone(raw: string | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, '');
  if (d.length === 10) return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
  if (d.length === 11 && d.startsWith('1')) {
    return '(' + d.slice(1, 4) + ') ' + d.slice(4, 7) + '-' + d.slice(7);
  }
  return raw.trim() || null;
}

/** Registry data is stored in caps. Titles and suffixes must survive the fix. */
const ACRONYMS =
  /\b(Pc|Pllc|Llc|Llp|Lp|Pa|Inc|Dds|Dmd|Md|Do|Dc|Od|Dpm|Pt|Ot|Slp|Rn|Np|Pa-C|Ceo|Cfo|Coo|Cto|Dvm|Faaid|Ii|Iii|Iv|Us|Usa|Ne|Nw|Se|Sw)\b/g;

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(ACRONYMS, (m) => m.toUpperCase())
    // Keep O'Brien and McNamara from being flattened.
    .replace(/\b(O')([a-z])/g, (_m, p, c: string) => p + c.toUpperCase())
    .replace(/\bMc([a-z])/g, (_m, c: string) => 'Mc' + c.toUpperCase());
}

/** Map one NPPES record into a Lead, or null if it fails the VA-target filter. */
function toLead(
  rec: NppesRecord,
  territoryId: string,
  wantedGroups: Set<string>,
  zipLookup: Map<string, ZipRow>,
  fetchedAt: string,
): Lead | null {
  const basic = rec.basic ?? {};
  const npi = String(rec.number ?? '');
  if (!npi) return null;

  // Deactivated records are dead ends.
  if (basic.status && basic.status.toUpperCase() === 'D') return null;

  const taxonomies = rec.taxonomies ?? [];
  const primary = taxonomies.find((t) => t.primary) ?? taxonomies[0];
  const desc = primary?.desc ?? '';
  if (!desc) return null;

  // Hospitals, assisted living, DME suppliers: they have procurement, not a
  // doctor who picks up the phone.
  if (isExcludedTaxonomy(desc)) return null;

  const group = groupForTaxonomy(desc);
  if (!wantedGroups.has(group)) return null;

  const rawName =
    basic.organization_name ??
    [basic.first_name, basic.last_name].filter(Boolean).join(' ');
  if (!rawName) return null;
  if (looksLikeLargeOrg(rawName)) return null;

  const loc =
    (rec.addresses ?? []).find((a) => a.address_purpose === 'LOCATION') ??
    (rec.addresses ?? [])[0];

  // Non-US locations occasionally appear; they are out of scope.
  if (loc?.country_code && loc.country_code !== 'US') return null;

  const zip5 = (loc?.postal_code ?? '').slice(0, 5) || null;
  const centroid = zip5 ? zipLookup.get(zip5) : undefined;
  const state = loc?.state ?? centroid?.state ?? null;
  const lon = centroid?.lon ?? null;

  const contactFirst = basic.authorized_official_first_name?.trim();
  const contactLast = basic.authorized_official_last_name?.trim();
  const contactName =
    contactFirst || contactLast
      ? titleCase([contactFirst, contactLast].filter(Boolean).join(' '))
      : null;

  const address = [loc?.address_1, loc?.address_2].filter(Boolean).join(' ').trim() || null;

  const lead: Lead = {
    id: 'npi-' + npi,
    territoryId,
    practiceName: titleCase(rawName.trim()),
    specialty: desc,
    specialtyGroup: group,
    phone: formatPhone(loc?.telephone_number),
    contactName,
    contactTitle: basic.authorized_official_title_or_position
      ? titleCase(basic.authorized_official_title_or_position)
      : null,
    contactPhone: formatPhone(basic.authorized_official_telephone_number),
    address: address ? titleCase(address) : null,
    city: loc?.city ? titleCase(loc.city) : centroid?.city ?? null,
    state,
    zip: zip5,
    lat: centroid?.lat ?? null,
    lon,
    timezone: timezoneFor(state, lon),
    website: null,
    email: null,
    enumeratedAt: basic.enumeration_date ?? null,
    recordUpdatedAt: basic.last_updated ?? null,
    score: 0,
    scoreReasons: [],
    callStatus: 'new',
    lastCalledAt: null,
    source: 'nppes',
    sourceId: npi,
    fetchedAt,
  };

  const { score, reasons } = scoreLead(lead);
  lead.score = score;
  lead.scoreReasons = reasons;
  return lead;
}

/**
 * Pull every organization record for one ZIP, paging until exhausted or until
 * the API ceiling is reached.
 */
async function fetchZip(
  zip: string,
  req: SearchRequest,
): Promise<{ records: NppesRecord[]; truncated: boolean; queries: number }> {
  const records: NppesRecord[] = [];
  let queries = 0;
  let truncated = false;

  for (let skip = 0; skip <= MAX_SKIP; skip += PAGE_SIZE) {
    req.cancel?.throwIfCancelled();

    const url = buildUrl({
      postal_code: zip,
      enumeration_type: 'NPI-2',
      limit: PAGE_SIZE,
      skip,
    });

    const data = await req.http.getJson<NppesResponse>(url);
    queries++;

    if (data.Errors?.length) break;
    const batch = data.results ?? [];
    records.push(...batch);

    // A short page means we have them all.
    if (batch.length < PAGE_SIZE) break;

    // A full page at the ceiling means there may be more we cannot reach.
    if (skip + PAGE_SIZE > MAX_SKIP) {
      truncated = true;
      break;
    }
  }

  return { records, truncated, queries };
}

export const nppesProvider: RegistryProvider = {
  id: 'nppes',
  label: 'NPPES NPI Registry',
  country: 'US',
  coverage: 'excellent',
  coverageNote:
    'US government registry. Practice phone on nearly every record, plus a named ' +
    'decision-maker with a direct line. No API key needed.',
  requiresKey: false,

  async search(req: SearchRequest): Promise<SearchResult> {
    const fetchedAt = new Date().toISOString();
    const warnings: string[] = [];
    const truncatedZips: string[] = [];

    const wantedKeys = req.specialties.length ? req.specialties : presetKeys();
    const wantedGroups = new Set(wantedKeys);

    req.onProgress?.({
      phase: 'resolving',
      message: 'Finding ZIP codes inside the box',
      current: 0,
      total: 0,
      leadsFound: 0,
    });

    const zipRows = zipsInBBox(req.zipIndex, req.bbox);
    if (zipRows.length === 0) {
      warnings.push(
        'No US ZIP codes fall inside this box. NPPES only covers the United States.',
      );
      return { leads: [], truncated: [], queriesRun: 0, warnings };
    }

    const zipLookup = new Map(zipRows.map((r) => [r.zip, r]));
    const zips = zipRows.map((r) => r.zip);

    let done = 0;
    let queriesRun = 0;
    const byId = new Map<string, Lead>();

    await mapLimit(zips, CONCURRENCY, async (zip) => {
      req.cancel?.throwIfCancelled();
      try {
        const { records, truncated, queries } = await fetchZip(zip, req);
        queriesRun += queries;
        if (truncated) truncatedZips.push(zip);

        for (const rec of records) {
          const lead = toLead(rec, req.territoryId, wantedGroups, zipLookup, fetchedAt);
          // Practices spanning several ZIPs can repeat; NPI is the identity.
          if (lead && !byId.has(lead.id)) byId.set(lead.id, lead);
        }
      } catch (err) {
        warnings.push('ZIP ' + zip + ' failed: ' + String(err));
      } finally {
        done++;
        req.onProgress?.({
          phase: 'querying',
          message: 'Searching ZIP ' + zip + ' (' + done + ' of ' + zips.length + ')',
          current: done,
          total: zips.length,
          leadsFound: byId.size,
        });
      }
    });

    if (truncatedZips.length) {
      warnings.push(
        truncatedZips.length +
          ' ZIP code(s) hit the registry result ceiling and may be incomplete: ' +
          truncatedZips.join(', ') +
          '. Draw a smaller box over these areas to get the rest.',
      );
    }

    const leads = [...byId.values()].sort((a, b) => b.score - a.score);

    return { leads, truncated: truncatedZips, queriesRun, warnings };
  },
};

/** Specialty groups this provider can actually deliver, for the UI. */
export function nppesSpecialties() {
  return SPECIALTY_GROUPS;
}
