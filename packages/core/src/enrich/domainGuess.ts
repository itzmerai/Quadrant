import type { Lead, ProgressFn } from '../types';
import type { Http, CancelToken } from '../http';
import { mapLimit } from '../http';

/**
 * Finds a practice's website by guessing its domain.
 *
 * The registry has no website field and OpenStreetMap only knows about ~15% of
 * practices, which is the ceiling on how many sites can be crawled for an
 * email. But small practices almost always own the obvious domain: Ironwood
 * Pediatric Dentistry is at ironwooddentistry.com far more often than not.
 *
 * Guessing is cheap. The risk is guessing *wrong* and attaching a stranger's
 * website to a lead, so every hit must be confirmed against something only the
 * real practice would have on its page.
 */

const STOP = new Set([
  'the', 'and', 'of', 'at', 'for', 'a', 'an', 'inc', 'llc', 'pllc', 'pc', 'pa',
  'llp', 'lp', 'ltd', 'co', 'corp', 'group', 'associates', 'assoc', 'office',
  'offices', 'practice', 'dr', 'doctor', 'professional', 'services', 'service',
  'management', 'holdings', 'enterprises', 'partners', 'clinic',
]);

/** Words a practice might swap for another on its domain. */
const SYNONYMS: Record<string, string[]> = {
  dentistry: ['dental', 'dentist'],
  dental: ['dentistry'],
  orthodontics: ['ortho', 'orthodontic'],
  chiropractic: ['chiro'],
  optometry: ['eyecare', 'vision', 'eye'],
  podiatry: ['foot', 'footcare'],
  dermatology: ['derm', 'skin'],
  pediatrics: ['pediatric', 'peds'],
  physical: ['pt'],
  psychology: ['counseling', 'therapy'],
};

const TLDS = ['com', 'net', 'org'];
const MAX_CANDIDATES = 6;
const CONCURRENCY = 8;

function words(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/**
 * Ordered best-guess first. Full name, then the distinctive head word paired
 * with the specialty word, then common substitutions.
 */
export function candidateDomains(practiceName: string): string[] {
  const w = words(practiceName);
  if (!w.length) return [];

  const stems = new Set<string>();
  const joined = w.join('');
  if (joined.length >= 5 && joined.length <= 30) stems.add(joined);

  if (w.length >= 2) {
    const head = w[0]!;
    const tail = w[w.length - 1]!;
    if ((head + tail).length <= 28) stems.add(head + tail);

    for (const alt of SYNONYMS[tail] ?? []) {
      if ((head + alt).length <= 28) stems.add(head + alt);
    }
    // First two words is a very common pattern: "ironwoodpediatric".
    if (w.length >= 3 && (head + w[1]!).length <= 28) stems.add(head + w[1]!);
  }

  const out: string[] = [];
  for (const stem of stems) {
    for (const tld of TLDS) {
      out.push(stem + '.' + tld);
      if (out.length >= MAX_CANDIDATES * TLDS.length) break;
    }
  }
  return out.slice(0, MAX_CANDIDATES);
}

/**
 * A page belongs to this practice only if it carries something specific to it.
 * Matching the name alone is not enough - dental chains reuse wording - so a
 * phone or ZIP match counts double.
 */
export function pageBelongsTo(html: string, lead: Lead): boolean {
  const text = html.toLowerCase().replace(/<[^>]+>/g, ' ');
  const digits = html.replace(/\D/g, '');

  // Strongest signal: the registry phone number appears on the page.
  if (lead.phone) {
    const bare = lead.phone.replace(/\D/g, '');
    if (bare.length === 10 && digits.includes(bare)) return true;
  }

  // Next: the practice's own ZIP plus a distinctive name word.
  const distinctive = words(lead.practiceName).filter((x) => x.length > 4);
  if (lead.zip && text.includes(lead.zip)) {
    if (distinctive.some((x) => text.includes(x))) return true;
  }

  // Weakest accepted: two distinctive name words AND the city.
  if (lead.city) {
    const city = lead.city.toLowerCase();
    const hits = distinctive.filter((x) => text.includes(x)).length;
    if (hits >= 2 && text.includes(city)) return true;
  }

  return false;
}

export interface DomainGuessResult {
  leads: Lead[];
  attempted: number;
  resolved: number;
  rejected: number;
}

async function guessOne(
  lead: Lead,
  http: Http,
): Promise<{ lead: Lead; resolved: boolean; rejected: boolean }> {
  const candidates = candidateDomains(lead.practiceName);
  let rejected = false;

  for (const domain of candidates) {
    const url = 'https://' + domain;
    try {
      const html = await http.getText(url);
      if (pageBelongsTo(html, lead)) {
        return { lead: { ...lead, website: url, enrichedAt: new Date().toISOString() }, resolved: true, rejected };
      }
      // It resolved but belongs to somebody else. Never attach it.
      rejected = true;
    } catch {
      // No such host, or it refused us. Try the next candidate.
    }
  }
  return { lead, resolved: false, rejected };
}

/**
 * Only runs for leads with no website yet. Verification is strict on purpose:
 * a wrong website is worse than no website, because she would research the
 * wrong practice before dialling.
 */
export async function guessWebsites(
  leads: Lead[],
  http: Http,
  onProgress?: ProgressFn,
  cancel?: CancelToken,
): Promise<DomainGuessResult> {
  const targets = leads.filter((l) => !l.website);
  if (!targets.length) return { leads, attempted: 0, resolved: 0, rejected: 0 };

  const byId = new Map(leads.map((l) => [l.id, l]));
  let done = 0;
  let resolved = 0;
  let rejected = 0;

  await mapLimit(targets, CONCURRENCY, async (lead) => {
    cancel?.throwIfCancelled();
    try {
      const r = await guessOne(lead, http);
      if (r.resolved) resolved++;
      if (r.rejected) rejected++;
      byId.set(lead.id, r.lead);
    } catch {
      /* leave the lead alone */
    } finally {
      done++;
      if (done % 10 === 0 || done === targets.length) {
        onProgress?.({
          phase: 'enriching',
          message:
            'Guessing website domains (' + done + ' of ' + targets.length +
            ', found ' + resolved + ')',
          current: done,
          total: targets.length,
          leadsFound: leads.length,
        });
      }
    }
  });

  return { leads: [...byId.values()], attempted: targets.length, resolved, rejected };
}
