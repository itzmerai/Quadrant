/**
 * Email extraction and ranking.
 *
 * A regex over a web page finds plenty of strings shaped like an address and
 * very few worth calling a lead. The filtering here does more work than the
 * matching does.
 */

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,24}/g;

/** Addresses that are never a person at the practice. */
const JUNK_LOCAL = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'mailer-daemon',
  'postmaster', 'abuse', 'webmaster@example', 'wordpress', 'wp', 'sentry',
  'example', 'test', 'user', 'name', 'youremail', 'email', 'your-email',
  'someone', 'domain', 'company', 'yourname', 'firstname', 'lastname',
];

const JUNK_DOMAIN = [
  'example.com', 'example.org', 'domain.com', 'yourdomain.com', 'email.com',
  'sentry.io', 'wixpress.com', 'godaddy.com', 'squarespace.com', 'w3.org',
  'schema.org', 'googlemail.com', 'placeholder.com', 'test.com', 'sentry.wixpress.com',
];

/** File extensions that mean this was an image filename, not an address. */
const FILE_EXT = /\.(png|jpe?g|gif|svg|webp|css|js|woff2?|ttf|ico|mp4|pdf)$/i;

/**
 * Ranked by who is likely to read it. An owner reads their own inbox;
 * a shared info@ box gets triaged by whoever she is trying to replace.
 */
const PREFIX_TIERS: Array<{ score: number; prefixes: string[]; label: string }> = [
  { score: 100, prefixes: ['owner', 'drhinkle', 'doctor', 'dr'], label: 'Owner or doctor' },
  { score: 90, prefixes: ['manager', 'officemanager', 'office.manager', 'admin'], label: 'Office manager' },
  { score: 70, prefixes: ['info', 'contact', 'hello', 'office', 'frontdesk', 'front.desk', 'reception'], label: 'General inbox' },
  { score: 55, prefixes: ['appointments', 'scheduling', 'schedule', 'booking'], label: 'Scheduling inbox' },
  { score: 40, prefixes: ['billing', 'accounts', 'insurance'], label: 'Billing inbox' },
  { score: 30, prefixes: ['support', 'help', 'sales', 'marketing'], label: 'Support inbox' },
  { score: 20, prefixes: ['careers', 'jobs', 'hr', 'recruiting'], label: 'Careers inbox' },
];

export interface RankedEmail {
  email: string;
  score: number;
  label: string;
}

export function isJunkEmail(email: string): boolean {
  const lower = email.toLowerCase();
  if (FILE_EXT.test(lower)) return true;
  const atIndex = lower.lastIndexOf('@');
  if (atIndex < 1) return true;
  const local = lower.slice(0, atIndex);
  const domain = lower.slice(atIndex + 1);

  if (JUNK_DOMAIN.some((d) => domain === d || domain.endsWith('.' + d))) return true;
  if (JUNK_LOCAL.some((j) => local === j || local.startsWith(j + '.') || local.startsWith(j + '-'))) {
    return true;
  }
  // Hex blobs are tracking IDs, not people.
  if (/^[0-9a-f]{16,}$/.test(local)) return true;
  if (local.length > 64 || domain.length > 100) return true;
  return false;
}

/** A personal-looking local part beats a generic one but loses to owner@. */
function looksPersonal(local: string): boolean {
  return /^[a-z]{2,}[._-][a-z]{2,}$/.test(local) || /^[a-z]\.[a-z]{2,}$/.test(local);
}

export function rankEmail(email: string): RankedEmail {
  const lower = email.toLowerCase();
  const local = lower.slice(0, lower.lastIndexOf('@'));

  for (const tier of PREFIX_TIERS) {
    if (tier.prefixes.some((p) => local === p || local.startsWith(p))) {
      return { email: lower, score: tier.score, label: tier.label };
    }
  }
  if (looksPersonal(local)) {
    return { email: lower, score: 85, label: 'Named person' };
  }
  return { email: lower, score: 50, label: 'Unknown inbox' };
}

/**
 * Cloudflare rewrites addresses into a hex blob to defeat scrapers. The first
 * byte is an XOR key for the rest, so the real address is recoverable.
 */
export function decodeCloudflare(html: string): string[] {
  const out: string[] = [];
  const re = /data-cfemail="([0-9a-f]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const hex = m[1]!;
    try {
      const key = parseInt(hex.slice(0, 2), 16);
      let decoded = '';
      for (let i = 2; i < hex.length; i += 2) {
        decoded += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
      }
      if (decoded.includes('@')) out.push(decoded);
    } catch {
      /* malformed blob */
    }
  }
  return out;
}

/** "name (at) practice (dot) com" and friends. */
export function decodeObfuscated(html: string): string[] {
  const text = html.replace(/<[^>]+>/g, ' ');
  const re =
    /([a-z0-9._%+-]+)\s*(?:\(at\)|\[at\]|\s+at\s+|&#64;)\s*([a-z0-9.-]+)\s*(?:\(dot\)|\[dot\]|\s+dot\s+)\s*([a-z]{2,24})/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push((m[1] + '@' + m[2] + '.' + m[3]).toLowerCase());
  return out;
}

/** Some practices publish no address at all, only a form. Worth knowing. */
export function findContactForm(html: string, pageUrl: string): string | null {
  const hasForm = /<form[\s\S]{0,4000}?(type=["']email["']|name=["'][^"']*email|placeholder=["'][^"']*email)/i;
  return hasForm.test(html) ? pageUrl : null;
}

/** Extract, clean, dedupe and rank every address on a page. */
export function extractEmails(html: string, siteDomain?: string): RankedEmail[] {
  const found = new Set<string>();

  for (const decoded of [...decodeCloudflare(html), ...decodeObfuscated(html)]) {
    if (!isJunkEmail(decoded)) found.add(decoded);
  }

  for (const raw of html.match(EMAIL_RE) ?? []) {
    const email = raw.toLowerCase().replace(/\.$/, '');
    if (FILE_EXT.test(email)) continue;
    if (isJunkEmail(email)) continue;
    found.add(email);
  }

  const ranked = [...found].map(rankEmail);

  // An address on the practice's own domain is far more likely to be theirs
  // than a gmail address scraped from a footer credit.
  if (siteDomain) {
    const bare = siteDomain.replace(/^www\./, '');
    for (const r of ranked) {
      if (r.email.endsWith('@' + bare) || r.email.endsWith('.' + bare)) r.score += 25;
    }
  }

  return ranked.sort((a, b) => b.score - a.score);
}

export function bestEmail(html: string, siteDomain?: string): RankedEmail | null {
  return extractEmails(html, siteDomain)[0] ?? null;
}
