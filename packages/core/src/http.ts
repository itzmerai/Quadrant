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

/**
 * Overrides for a single call, on top of whatever the client was built with.
 *
 * `signal` cannot be a construction-time option: the UI caches one `Http` in a
 * module singleton while every scan creates a fresh `CancelToken`, so a bound
 * token would be spent for good after the first Stop. It has to arrive per
 * request, which means the public methods - not just `request` - must take it.
 *
 * `timeoutMs` and `retries` ride along because one call genuinely needs a
 * different budget: the Overpass query asks the server for up to 90 seconds
 * while this client aborts at 25, so on a large box it can never succeed.
 */
export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
}

export const DEFAULT_USER_AGENT =
  'Quadrant/0.1 (medical VA lead tool; https://github.com/quadrant)';

const DEFAULT_TIMEOUT = 20_000;

export class HttpError extends Error {
  readonly status?: number;
  readonly url?: string;
  constructor(message: string, status?: number, url?: string, opts?: { cause?: unknown }) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    if (opts && 'cause' in opts) (this as { cause?: unknown }).cause = opts.cause;
  }
}

/**
 * Abortable so a cancelled request does not sit out its backoff. Without the
 * signal a Stop pressed between attempts is invisible for up to four seconds,
 * which is most of the delay the user actually feels.
 */
export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new CancelledError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });

const backoff = (attempt: number) => Math.min(400 * 2 ** attempt, 4_000) + Math.random() * 250;

export function createHttp(opts: HttpOptions = {}) {
  const doFetch: FetchFn = opts.fetchFn ?? ((u, i) => fetch(u, i));
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const retries = opts.retries ?? 2;

  const rewrite = opts.rewriteUrl ?? ((u: string) => u);
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;

  async function request(
    rawUrl: string,
    init: RequestInit = {},
    call: RequestOptions = {},
  ): Promise<Response> {
    const url = rewrite(rawUrl);
    const headers = { 'User-Agent': userAgent, ...(init.headers as Record<string, string>) };
    /**
     * The caller's cancellation, if it handed one over (`cancelToken.signal`).
     * It outlives the attempt loop, unlike the per-attempt timeout controller.
     */
    const cancelSignal = call.signal ?? init.signal ?? undefined;
    // Per-call overrides fall back to the values this client was built with.
    const callTimeout = call.timeoutMs ?? timeoutMs;
    const callRetries = call.retries ?? retries;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= callRetries; attempt++) {
      // Cheapest possible stop: a token cancelled before or between attempts
      // must not open a socket at all.
      if (cancelSignal?.aborted) throw new CancelledError();

      const ctrl = new AbortController();
      // Either the timeout or the caller's cancellation aborts this attempt.
      // The two are forwarded by hand rather than via AbortSignal.any so this
      // keeps working on older WebView2/Safari runtimes the desktop app meets.
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, callTimeout);
      const forwardCancel = () => ctrl.abort();
      cancelSignal?.addEventListener('abort', forwardCancel, { once: true });
      const release = () => {
        clearTimeout(timer);
        cancelSignal?.removeEventListener('abort', forwardCancel);
      };
      try {
        const res = await doFetch(url, { ...init, headers, signal: ctrl.signal });
        release();
        // 429 and 5xx are worth another attempt; 4xx never is.
        if (res.status === 429 || res.status >= 500) {
          if (attempt < callRetries) {
            await sleep(backoff(attempt), cancelSignal);
            continue;
          }
          throw new HttpError('HTTP ' + res.status, res.status, url);
        }
        return res;
      } catch (err) {
        release();
        /**
         * A cancellation is not a transient failure. Retrying it ignores the
         * Stop, and letting it fall through to the HttpError below hides it
         * from `isCancelled`, which every narrowed catch upstream depends on.
         * So rethrow it here, in its own shape.
         *
         * The caller's signal is what decides: the per-attempt timeout aborts
         * with exactly the same `AbortError` shape and *is* worth another try,
         * so shape alone cannot tell a stop from a slow endpoint. The shape
         * check is only the fallback for a cancellation raised somewhere below
         * us - the Tauri plugin's own - and it is gated on the timeout not
         * having fired, which is the only other thing that aborts this attempt.
         */
        if (cancelSignal?.aborted) throw isCancelled(err) ? err : new CancelledError();
        if (!timedOut && isCancelled(err)) throw err;
        lastErr = err;
        if (attempt < callRetries) await sleep(backoff(attempt), cancelSignal);
      }
    }
    /**
     * The cause rides as `cause`, never interpolated into the message.
     *
     * It used to be `'... attempts: ' + String(lastErr)`, and in the packaged
     * app that was a live defect: a per-attempt *timeout* calls `ctrl.abort()`,
     * the Tauri plugin reports an abort as `Error('Request cancelled')`, and
     * that text then landed inside this message - where `isCancelled` matched
     * it. A slow endpoint reported as a user Stop, so the scan announced
     * "Stopped" and quietly kept whatever it had.
     */
    throw new HttpError(
      'Request failed after ' + (callRetries + 1) + ' attempts',
      undefined,
      url,
      { cause: lastErr },
    );
  }

  /**
   * The attempt loop releases its timer and its abort forwarding the moment
   * headers arrive, so everything below - reading the body - used to run with
   * no timeout and no way for a Stop to reach it. A server that answers and
   * then stalls the stream hung the worker permanently, and Stop could not
   * clear it. That is the whole crawl pool on six stalled hosts, and it made
   * the Overpass call's 95-second budget a promise about headers only.
   *
   * This bounds the read and lets a cancellation reject it. The socket may
   * linger until the runtime reaps it; what matters is that the caller stops
   * waiting and the pool drains.
   */
  function readWithin<T>(work: Promise<T>, call: RequestOptions, url: string): Promise<T> {
    const ms = call.timeoutMs ?? timeoutMs;
    const signal = call.signal;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        fn();
      };
      function onAbort() {
        finish(() => reject(new CancelledError()));
      }
      const timer = setTimeout(
        () => finish(() => reject(new HttpError('Body read timed out', undefined, url))),
        ms,
      );
      if (signal?.aborted) return finish(() => reject(new CancelledError()));
      signal?.addEventListener('abort', onAbort, { once: true });
      work.then(
        (v) => finish(() => resolve(v)),
        (e) => finish(() => reject(e)),
      );
    });
  }

  async function getJson<T>(url: string, call: RequestOptions = {}): Promise<T> {
    const res = await request(url, { headers: { Accept: 'application/json' } }, call);
    if (!res.ok) throw new HttpError('HTTP ' + res.status, res.status, url);
    return (await readWithin(res.json(), call, url)) as T;
  }

  async function postForm<T>(url: string, body: string, call: RequestOptions = {}): Promise<T> {
    const res = await request(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
      call,
    );
    if (!res.ok) throw new HttpError('HTTP ' + res.status, res.status, url);
    return (await readWithin(res.json(), call, url)) as T;
  }

  async function getText(url: string, call: RequestOptions = {}): Promise<string> {
    const res = await request(url, { headers: { Accept: 'text/html,*/*' } }, call);
    if (!res.ok) throw new HttpError('HTTP ' + res.status, res.status, url);
    return await readWithin(res.text(), call, url);
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
  /**
   * The first failure stops the pool.
   *
   * `Promise.all` rejects on the first worker to throw, but it does not stop
   * the others - they kept pulling items and kept reporting progress after the
   * caller had already taken its snapshot and moved on. On a stop that meant
   * running-phase progress events landing *after* the terminal one, which
   * flips the UI back into "scanning" with nothing left to clear it.
   */
  let didFail = false;
  let firstErr: unknown;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      if (didFail) return;
      const i = cursor++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i]!, i);
      } catch (err) {
        if (!didFail) {
          didFail = true;
          firstErr = err;
        }
        return;
      }
    }
  });
  // settled, not all: every worker must have stopped before the caller reads
  // the accumulator, or a straggler mutates it behind the snapshot.
  await Promise.allSettled(workers);
  if (didFail) throw firstErr;
  return out;
}

/**
 * Cancellation for long scans. Backed by an `AbortController` so a stop reaches
 * a request that is already in flight; a polled flag only ever took effect
 * between requests, which meant waiting out a 25-second timeout to notice.
 * The flag surface (`cancel`, `cancelled`, `throwIfCancelled`) is unchanged,
 * so every existing caller keeps working; `signal` is what is new. Pass it as
 * `init.signal` to `http.request` for the abort to actually reach the socket.
 */
export class CancelToken {
  private readonly ctrl = new AbortController();
  get signal(): AbortSignal {
    return this.ctrl.signal;
  }
  cancel() {
    this.ctrl.abort();
  }
  get cancelled() {
    return this.ctrl.signal.aborted;
  }
  throwIfCancelled() {
    if (this.cancelled) throw new CancelledError();
  }
}

export class CancelledError extends Error {
  constructor() {
    super('Scan cancelled');
    this.name = 'CancelledError';
  }
}

/**
 * The Tauri HTTP plugin's own abort message. It throws `new Error(...)` with
 * this text - a plain `Error`, not a `DOMException` named `AbortError` - and
 * its streamed body path rejects with this bare string, no wrapper at all.
 * Verified in @tauri-apps/plugin-http/dist-js/index.js.
 */
const TAURI_CANCELLED = 'Request cancelled';

/**
 * True when an error means "someone pressed Stop" rather than "this failed".
 * Deliberately shape-based rather than class-based: matching only
 * `CancelledError` and `AbortError` passes in browser dev and in Node tests
 * while returning false in the packaged desktop app, which is the one build
 * the user actually runs - Stop would be silently absorbed there.
 */
export function isCancelled(err: unknown): boolean {
  if (err instanceof CancelledError) return true;
  /**
   * An `HttpError` is never how this module reports a stop - a cancellation
   * leaves `request` in its own shape, unwrapped. So an `HttpError` whose text
   * happens to mention a cancellation is a *failure*, and treating it as a stop
   * would turn a slow endpoint into a silent "Stopped" the user never asked
   * for. Checked before the message match below, which is what let that
   * through.
   */
  if (err instanceof HttpError) return false;
  if (typeof err === 'string') return err.trim() === TAURI_CANCELLED;
  if (typeof err !== 'object' || err === null) return false;
  const { name, message } = err as { name?: unknown; message?: unknown };
  if (name === 'AbortError' || name === 'CancelledError') return true;
  // `includes` rather than equality: a cancellation that crossed a layer which
  // stringified it ("Error: Request cancelled") still has to be recognised.
  return typeof message === 'string' && message.includes(TAURI_CANCELLED);
}
