import type { Http } from '../http';

/**
 * Does this domain accept mail at all?
 *
 * DNS-over-HTTPS at Cloudflare: free, no API key, no signup, and it works
 * from the app without a DNS library. It answers "would mail to this domain
 * bounce outright", which is the difference between a usable guessed address
 * and one that damages her sender reputation.
 *
 * It does NOT prove a specific mailbox exists - only that the domain is set up
 * to receive mail somewhere.
 */

const DOH = 'https://cloudflare-dns.com/dns-query';

interface DohAnswer {
  type?: number;
  data?: string;
}

interface DohResponse {
  Answer?: DohAnswer[];
}

const MX_TYPE = 15;

/** Domains repeat constantly across a territory, so never look one up twice. */
const cache = new Map<string, boolean>();

export function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

export async function acceptsMail(domain: string, http: Http): Promise<boolean> {
  const key = domain.toLowerCase();
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let ok = false;
  try {
    const res = await http.request(
      DOH + '?name=' + encodeURIComponent(key) + '&type=MX',
      { headers: { Accept: 'application/dns-json' } },
    );
    if (res.ok) {
      const data = (await res.json()) as DohResponse;
      ok = (data.Answer ?? []).some((a) => a.type === MX_TYPE && !!a.data);
    }
  } catch {
    // A failed lookup is not proof of anything; treat it as "do not guess".
    ok = false;
  }

  cache.set(key, ok);
  return ok;
}

/**
 * The address a small practice is most likely to actually own.
 *
 * Deliberately conservative: one guess per practice, and only the prefix that
 * is near-universal for small businesses. Guessing firstname@ from the
 * authorized official would bounce far more often than it would land.
 */
export function guessAddress(domain: string): string {
  return 'info@' + domain.replace(/^www\./, '').toLowerCase();
}
