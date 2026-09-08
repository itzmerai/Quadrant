import type { Lead, ProgressFn } from '../types';
import type { Http, CancelToken } from '../http';
import { isCancelled, mapLimit } from '../http';
import { bestEmail, findContactForm } from './email';
import { acceptsMail, guessAddress } from './mx';
import { rescore } from '../score';

/**
 * Visits the pages where a small practice actually publishes an address.
 * Homepage first, because many one-page sites put it in the footer; then the
 * conventional contact routes.
 */
const PATHS = ['', '/contact', '/contact-us', '/about', '/about-us', '/appointments', '/new-patients'];

const CONCURRENCY = 6;
const PER_PAGE_TIMEOUT = 12_000;

export interface CrawlResult {
  leads: Lead[];
  attempted: number;
  found: number;
  /**
   * The user pressed Stop. `leads` still carries every email and website the
   * crawl had already found, which is the whole reason this is a flag rather
   * than a thrown error (R3).
   */
  cancelled: boolean;
}

function normalizeUrl(raw: string): string | null {
  let url = raw.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

function domainOf(origin: string): string | undefined {
  try {
    return new URL(origin).hostname;
  } catch {
    return undefined;
  }
}

/** Follow the site's own contact link if the conventional paths all 404. */
function findContactLink(html: string, origin: string): string | null {
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1] ?? '';
    const text = (m[2] ?? '').replace(/<[^>]*>/g, '').toLowerCase();
    if (!/contact|reach us|get in touch/.test(text)) continue;
    try {
      const abs = new URL(href, origin);
      if (abs.origin !== origin) continue;
      return abs.href;
    } catch {
      /* skip malformed href */
    }
  }
  return null;
}

async function crawlOne(lead: Lead, http: Http, cancel?: CancelToken): Promise<Lead> {
  const origin = lead.website ? normalizeUrl(lead.website) : null;
  if (!origin) return lead;
  const domain = domainOf(origin);

  let discovered: string | null = null;
  let formUrl: string | null = null;

  const pages: string[] = [];
  for (const path of PATHS) pages.push(origin + path);

  for (let i = 0; i < pages.length; i++) {
    const url = pages[i]!;
    try {
      const html = await http.getText(url, {
        signal: cancel?.signal,
        // Applied at last: the constant predates the per-call budget and had no
        // way to reach a request. Without it a blackholed host held a worker
        // for the 25s default times three attempts, per page, up to eight pages.
        timeoutMs: PER_PAGE_TIMEOUT,
        retries: 0,
      });

      const hit = bestEmail(html, domain);
      if (hit) {
        return rescore({
          ...lead,
          email: hit.email,
          emailConfidence: 'published',
          website: origin,
          contactFormUrl: formUrl,
          enrichedAt: new Date().toISOString(),
        });
      }

      // No address here, but a form is still a way through.
      if (!formUrl) formUrl = findContactForm(html, url);
      // Follow the site's own contact link if the usual paths miss.
      if (i === 0 && !discovered) {
        discovered = findContactLink(html, origin);
        if (discovered && !pages.includes(discovered)) pages.push(discovered);
      }
    } catch (err) {
      // A dead path is ordinary and worth ignoring; a stop is neither, and
      // walking the remaining six paths after it is pure wasted time.
      if (isCancelled(err)) throw err;
    }
  }

  /**
   * Nothing published. If the domain accepts mail, info@ is the address a
   * small practice is most likely to own - marked as a guess so she can see
   * the difference before she sends anything.
   */
  if (domain && (await acceptsMail(domain, http, cancel))) {
    return rescore({
      ...lead,
      email: guessAddress(domain),
      emailConfidence: 'guessed',
      website: origin,
      contactFormUrl: formUrl,
      enrichedAt: new Date().toISOString(),
    });
  }

  return {
    ...lead,
    website: origin,
    contactFormUrl: formUrl,
    enrichedAt: new Date().toISOString(),
  };
}

/**
 * Only leads that already have a website are worth crawling, which in practice
 * is a minority. This is a top-up, never the primary contact source.
 */
export async function crawlForEmails(
  leads: Lead[],
  http: Http,
  onProgress?: ProgressFn,
  cancel?: CancelToken,
): Promise<CrawlResult> {
  const targets = leads.filter((l) => l.website && !l.email);
  if (!targets.length) return { leads, attempted: 0, found: 0, cancelled: false };

  const byId = new Map(leads.map((l) => [l.id, l]));
  let done = 0;
  let found = 0;
  let cancelled = false;

  const crawler = { ...http };

  try {
    await mapLimit(targets, CONCURRENCY, async (lead) => {
      cancel?.throwIfCancelled();
      try {
        const next = await crawlOne(lead, crawler as Http, cancel);
        if (next.email && !lead.email) found++;
        byId.set(lead.id, next);
      } catch (err) {
        // One unreachable site is nothing; a stop is everything.
        if (isCancelled(err)) throw err;
        /* leave the lead as it was */
      } finally {
        done++;
        onProgress?.({
          phase: 'enriching',
          message: 'Checking practice websites for email (' + done + ' of ' + targets.length + ')',
          current: done,
          total: targets.length,
          leadsFound: leads.length,
        });
      }
    });
  } catch (err) {
    // KTD2: the stop stops here and becomes a flag. `byId` already holds every
    // email and website the finished crawls found, and those are kept (R3).
    if (!isCancelled(err)) throw err;
    cancelled = true;
  }

  const out = [...byId.values()].sort((a, b) => b.score - a.score);
  return { leads: out, attempted: targets.length, found, cancelled };
}

export { PER_PAGE_TIMEOUT };
