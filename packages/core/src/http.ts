/**
 * NPPES sends no CORS headers, so a browser cannot call it directly.
 * Tauri routes requests through Rust (no CORS) and the Vite dev server
 * proxies them. Core stays agnostic: it is handed a fetch and uses it.
 */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  fetchFn?: FetchFn;
  timeoutMs?: number;
  retries?: number;
  /**
   * Last chance to rewrite a URL before it is issued. Browser dev maps the
   * real origins onto Vite proxy paths here; Tauri leaves them untouched.
   */
  rewriteUrl?: (url: string) => string;
  /**
   * Overpass rejects the default Node user-agent with a 406, and its usage
   * policy asks callers to identify themselves. Browsers ignore this - the
   * header is forbidden there - and send their own, which Overpass accepts.
   */
  userAgent?: string;
}

export const DEFAULT_USER_AGENT =
  'Quadrant/0.1 (medical VA lead tool; https://github.com/quadrant)';

const DEFAULT_TIMEOUT = 20_000;

export class HttpError extends Error {
  readonly status?: number;
  readonly url?: string;
  constructor(message: string, status?: number, url?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const backoff = (attempt: number) => Math.min(400 * 2 ** attempt, 4_000) + Math.random() * 250;

export function createHttp(opts: HttpOptions = {}) {
  const doFetch: FetchFn = opts.fetchFn ?? ((u, i) => fetch(u, i));
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const retries = opts.retries ?? 2;

  const rewrite = opts.rewriteUrl ?? ((u: string) => u);
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;

  async function request(rawUrl: string, init: RequestInit = {}): Promise<Response> {
    const url = rewrite(rawUrl);
    const headers = { 'User-Agent': userAgent, ...(init.headers as Record<string, string>) };
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await doFetch(url, { ...init, headers, signal: ctrl.signal });
        clearTimeout(timer);
        // 429 and 5xx are worth another attempt; 4xx never is.
        if (res.status === 429 || res.status >= 500) {
          if (attempt < retries) {
            await sleep(backoff(attempt));
            continue;
          }
          throw new HttpError('HTTP ' + res.status, res.status, url);
        }
        return res;
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        if (attempt < retries) await sleep(backoff(attempt));
      }
    }
    throw new HttpError(
      'Request failed after ' + (retries + 1) + ' attempts: ' + String(lastErr),
      undefined,
      url,
    );
  }

  async function getJson<T>(url: string): Promise<T> {
    const res = await request(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new HttpError('HTTP ' + res.status, res.status, url);
    return (await res.json()) as T;
  }

  async function postForm<T>(url: string, body: string): Promise<T> {
    const res = await request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new HttpError('HTTP ' + res.status, res.status, url);
    return (await res.json()) as T;
  }

  async function getText(url: string): Promise<string> {
    const res = await request(url, { headers: { Accept: 'text/html,*/*' } });
    if (!res.ok) throw new HttpError('HTTP ' + res.status, res.status, url);
    return await res.text();
  }

  return { request, getJson, getText, postForm };
}

export type Http = ReturnType<typeof createHttp>;

/** Bounded-concurrency map. Keeps the crawler polite and the UI responsive. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Cooperative cancellation for long scans. */
export class CancelToken {
  private flag = false;
  cancel() {
    this.flag = true;
  }
  get cancelled() {
    return this.flag;
  }
  throwIfCancelled() {
    if (this.flag) throw new CancelledError();
  }
}

export class CancelledError extends Error {
  constructor() {
    super('Scan cancelled');
    this.name = 'CancelledError';
  }
}
