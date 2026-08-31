import type { Lead, ProgressFn } from '../types';
import type { Http, CancelToken } from '../http';
import { mapLimit } from '../http';
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

async function crawlOne(lead: Lead, http: Http): Promise<Lead> {
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
      const html = await http.getText(url);

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
    } catch {
      // A dead path is ordinary. Keep going.
    }
  }

  /**
   * Nothing published. If the domain accepts mail, info@ is the address a
   * small practice is most likely to own - marked as a guess so she can see
   * the difference before she sends anything.
   */
  if (domain && (await acceptsMail(domain, http))) {
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
  if (!targets.length) return { leads, attempted: 0, found: 0 };

  const byId = new Map(leads.map((l) => [l.id, l]));
  let done = 0;
  let found = 0;

  const crawler = { ...http };

  await mapLimit(targets, CONCURRENCY, async (lead) => {
    cancel?.throwIfCancelled();
    try {
      const next = await crawlOne(lead, crawler as Http);
      if (next.email && !lead.email) found++;
      byId.set(lead.id, next);
    } catch {
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

  const out = [...byId.values()].sort((a, b) => b.score - a.score);
  return { leads: out, attempted: targets.length, found };
}

export { PER_PAGE_TIMEOUT };
