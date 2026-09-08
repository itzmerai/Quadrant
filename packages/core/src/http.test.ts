import { describe, expect, it } from 'vitest';
import {
  CancelToken,
  CancelledError,
  HttpError,
  createHttp,
  isCancelled,
  mapLimit,
  type FetchFn,
} from './http';

/**
 * The Tauri HTTP plugin does not abort the way a browser does: it throws a
 * plain `Error` whose message is this string, and its streamed body path
 * rejects with the bare string itself. Verified against
 * node_modules/@tauri-apps/plugin-http/dist-js/index.js.
 */
const TAURI_CANCELLED = 'Request cancelled';

/** What a browser (and Node) fetch rejects with when its signal aborts. */
const abortError = () => new DOMException('The operation was aborted.', 'AbortError');

/**
 * A fetch that never settles on its own, so the only way out is the signal.
 * This is the shape that made the old polled flag useless: without an abort,
 * a request like this runs to its full timeout before anyone notices Stop.
 */
function hangingFetch(calls: { count: number }, reject: () => unknown = abortError): FetchFn {
  return (_url, init) =>
    new Promise<Response>((_resolve, rej) => {
      calls.count++;
      const signal = init?.signal;
      if (signal?.aborted) return rej(reject());
      signal?.addEventListener('abort', () => rej(reject()), { once: true });
    });
}

/** Only `status` is read by the retry loop, so a stub beats a real Response. */
const statusOnly = (status: number) => ({ status, ok: status < 400 }) as unknown as Response;

/** Milliseconds a settled promise took, so "well under a second" is asserted. */
async function elapsed(fn: () => Promise<unknown>): Promise<{ ms: number; err: unknown }> {
  const started = Date.now();
  try {
    await fn();
    return { ms: Date.now() - started, err: null };
  } catch (err) {
    return { ms: Date.now() - started, err };
  }
}

describe('cancellation during a request', () => {
  it('aborts a request that is already in flight rather than resolving', async () => {
    const calls = { count: 0 };
    const http = createHttp({ fetchFn: hangingFetch(calls), timeoutMs: 20_000, retries: 2 });
    const token = new CancelToken();

    const { ms, err } = await elapsed(async () => {
      const pending = http.request('https://example.test/slow', { signal: token.signal });
      setTimeout(() => token.cancel(), 20);
      return pending;
    });

    expect(err).not.toBeNull();
    expect(isCancelled(err)).toBe(true);
    // R1: a stop lands in about a second, not at the 20s request timeout.
    expect(ms).toBeLessThan(1_000);
    expect(calls.count).toBe(1);
  });

  it('rejects with a cancellation, never an HttpError wrapping one', async () => {
    // The old loop funnelled every failure into `lastErr` and threw an
    // HttpError once attempts ran out, so an abort on the final attempt
    // reached callers unrecognisable. Cancelling on the last attempt is
    // exactly that case.
    const calls = { count: 0 };
    const http = createHttp({ fetchFn: hangingFetch(calls), timeoutMs: 20_000, retries: 0 });
    const token = new CancelToken();

    const pending = http.request('https://example.test/slow', { signal: token.signal });
    setTimeout(() => token.cancel(), 20);

    await expect(pending).rejects.toSatisfy(isCancelled);
    await expect(pending).rejects.not.toBeInstanceOf(HttpError);
  });

  it('settles immediately when cancelled during the backoff between attempts', async () => {
    // Backoff after the first 500 is at least 400ms; a stop must not wait it out.
    const calls = { count: 0 };
    const http = createHttp({
      fetchFn: async () => {
        calls.count++;
        return statusOnly(500);
      },
      retries: 3,
    });
    const token = new CancelToken();

    const { ms, err } = await elapsed(async () => {
      const pending = http.request('https://example.test/flaky', { signal: token.signal });
      setTimeout(() => token.cancel(), 20);
      return pending;
    });

    expect(isCancelled(err)).toBe(true);
    expect(ms).toBeLessThan(300);
    expect(calls.count).toBe(1);
  });

  it('performs no network call at all when the token was cancelled first', async () => {
    const calls = { count: 0 };
    const http = createHttp({ fetchFn: hangingFetch(calls) });
    const token = new CancelToken();
    token.cancel();

    await expect(
      http.request('https://example.test/never', { signal: token.signal }),
    ).rejects.toSatisfy(isCancelled);
    expect(calls.count).toBe(0);
  });

  it('reports a cancellation the Tauri plugin raised as a cancellation', async () => {
    // The packaged app is the only build the user runs, and its abort throws
    // a plain Error - not a DOMException - so this shape must survive the loop.
    const calls = { count: 0 };
    const http = createHttp({
      fetchFn: hangingFetch(calls, () => new Error(TAURI_CANCELLED)),
      retries: 2,
    });
    const token = new CancelToken();

    const { err } = await elapsed(async () => {
      const pending = http.request('https://example.test/slow', { signal: token.signal });
      setTimeout(() => token.cancel(), 20);
      return pending;
    });

    expect(isCancelled(err)).toBe(true);
    expect(err).not.toBeInstanceOf(HttpError);
    expect(calls.count).toBe(1);
  });
});

describe('CancelToken', () => {
  it('keeps the flag surface its existing callers rely on', () => {
    const token = new CancelToken();
    expect(token.cancelled).toBe(false);
    expect(() => token.throwIfCancelled()).not.toThrow();

    token.cancel();
    expect(token.cancelled).toBe(true);
    expect(() => token.throwIfCancelled()).toThrow(CancelledError);
  });

  it('exposes a signal that aborts when the token is cancelled', () => {
    const token = new CancelToken();
    expect(token.signal.aborted).toBe(false);
    token.cancel();
    expect(token.signal.aborted).toBe(true);
  });
});

describe('isCancelled', () => {
  it('is true for core’s own CancelledError', () => {
    expect(isCancelled(new CancelledError())).toBe(true);
  });

  it('is true for the browser AbortError', () => {
    expect(isCancelled(abortError())).toBe(true);
  });

  it('is true for the Tauri plugin Error-with-message form', () => {
    expect(isCancelled(new Error(TAURI_CANCELLED))).toBe(true);
  });

  it('is true for the Tauri plugin bare-string form', () => {
    // The streamed body path calls controller.error('Request cancelled'),
    // so the rejection value is a string with no name or message at all.
    expect(isCancelled(TAURI_CANCELLED)).toBe(true);
  });

  it('is false for an ordinary HTTP failure', () => {
    expect(isCancelled(new HttpError('HTTP 500', 500, 'https://example.test'))).toBe(false);
    expect(isCancelled(new Error('getaddrinfo ENOTFOUND example.test'))).toBe(false);
    expect(isCancelled(null)).toBe(false);
    expect(isCancelled(undefined)).toBe(false);
    expect(isCancelled('boom')).toBe(false);
  });

  it('is false for a timeout that nobody cancelled', async () => {
    // A timeout aborts with the same AbortError shape as a stop, so the loop -
    // not the predicate - has to tell them apart: an uncancelled timeout must
    // still surface as an HttpError so retry and error reporting behave.
    const calls = { count: 0 };
    const http = createHttp({ fetchFn: hangingFetch(calls), timeoutMs: 10, retries: 0 });

    const err = await http.request('https://example.test/slow').catch((e: unknown) => e);

    expect(isCancelled(err)).toBe(false);
    expect(err).toBeInstanceOf(HttpError);
  });
});

describe('retry behaviour is unchanged for ordinary failures', () => {
  it('still retries the configured number of times when nothing was cancelled', async () => {
    const calls = { count: 0 };
    const http = createHttp({
      fetchFn: async () => {
        calls.count++;
        throw new Error('boom');
      },
      retries: 1,
    });

    const err = await http.request('https://example.test/broken').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpError);
    expect(calls.count).toBe(2);
  });
});

/*
 * Per-call overrides (KTD10).
 *
 * The abort mechanism above is only reachable if a caller can hand its signal
 * to the method it actually uses. `getJson`/`getText`/`postForm` are the whole
 * public surface, and a construction-time token cannot work: the UI caches one
 * `Http` in a module singleton while each scan makes a fresh `CancelToken`, so
 * a bound token would be permanently spent after the first Stop.
 *
 * Timeout and retries ride the same options bag because they are the same API
 * change; the Overpass call that needs them is gated separately on verifying
 * the abort in the packaged app.
 */
describe('per-call options', () => {
  it('passes a caller signal through getJson so a stop aborts in flight', async () => {
    const calls = { count: 0 };
    const http = createHttp({ fetchFn: hangingFetch(calls), retries: 0, timeoutMs: 60_000 });
    const cancel = new CancelToken();

    const started = Date.now();
    const pending = http.getJson('https://example.test/x', { signal: cancel.signal });
    cancel.cancel();

    await expect(pending).rejects.toSatisfy(isCancelled);
    // Without the signal reaching request(), this would sit for the full 60s.
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('passes a caller signal through postForm', async () => {
    const calls = { count: 0 };
    const http = createHttp({ fetchFn: hangingFetch(calls), retries: 0, timeoutMs: 60_000 });
    const cancel = new CancelToken();

    const pending = http.postForm('https://example.test/x', 'data=1', { signal: cancel.signal });
    cancel.cancel();

    await expect(pending).rejects.toSatisfy(isCancelled);
  });

  it('passes a caller signal through getText', async () => {
    const calls = { count: 0 };
    const http = createHttp({ fetchFn: hangingFetch(calls), retries: 0, timeoutMs: 60_000 });
    const cancel = new CancelToken();

    const pending = http.getText('https://example.test/x', { signal: cancel.signal });
    cancel.cancel();

    await expect(pending).rejects.toSatisfy(isCancelled);
  });

  it('uses a per-call timeout instead of the client default', async () => {
    const calls = { count: 0 };
    // Client default is long; the per-call override is what must bite.
    const http = createHttp({ fetchFn: hangingFetch(calls), retries: 0, timeoutMs: 60_000 });

    const started = Date.now();
    await expect(
      http.getJson('https://example.test/x', { timeoutMs: 120 }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('leaves the client default intact for other calls', async () => {
    const calls = { count: 0 };
    const http = createHttp({ fetchFn: hangingFetch(calls), retries: 0, timeoutMs: 150 });

    // One call overrides to something longer, the next must still use 150ms.
    await expect(http.getJson('https://example.test/a', { timeoutMs: 400 })).rejects.toBeTruthy();
    const started = Date.now();
    await expect(http.getJson('https://example.test/b')).rejects.toBeTruthy();
    expect(Date.now() - started).toBeLessThan(400);
  });

  it('uses a per-call retry count', async () => {
    const calls = { count: 0 };
    const fetchFn: FetchFn = async () => {
      calls.count++;
      return statusOnly(429);
    };
    // Client says two retries; the call asks for one, so two attempts total.
    const http = createHttp({ fetchFn, retries: 2, timeoutMs: 1_000 });

    await expect(
      http.getJson('https://example.test/x', { retries: 1 }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(calls.count).toBe(2);
  });
});

/*
 * Regressions found in review.
 *
 * Both are packaged-app-only in origin, which is exactly why they need tests:
 * neither reproduces in browser dev, and the first one made a slow endpoint
 * indistinguishable from a user pressing Stop.
 */
describe('a failure is never mistaken for a stop', () => {
  it('does not report an exhausted retry as a cancellation, even when Tauri worded it that way', async () => {
    // The packaged path: the per-attempt timeout aborts, and the Tauri plugin
    // words its abort as Error('Request cancelled'). Retries exhaust, and the
    // wrapper used to interpolate that text into its own message - which
    // isCancelled then matched, reporting a slow endpoint as her Stop.
    const calls = { count: 0 };
    const http = createHttp({
      fetchFn: hangingFetch(calls, () => new Error(TAURI_CANCELLED)),
      retries: 2,
      timeoutMs: 20,
    });

    await expect(http.getJson('https://example.test/slow')).rejects.toSatisfy(
      (err: unknown) => err instanceof HttpError && !isCancelled(err),
    );
    // All three attempts ran: the loop treated it as a timeout, not a stop.
    expect(calls.count).toBe(3);
  });

  it('keeps the underlying failure reachable as cause rather than in the message', async () => {
    const calls = { count: 0 };
    const http = createHttp({
      fetchFn: hangingFetch(calls, () => new Error(TAURI_CANCELLED)),
      retries: 0,
      timeoutMs: 20,
    });

    const err = await http.getJson('https://example.test/slow').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as Error).message).not.toContain(TAURI_CANCELLED);
    expect((err as { cause?: Error }).cause?.message).toBe(TAURI_CANCELLED);
  });
});

describe('a stalled response body', () => {
  /** Headers arrive, then the body never settles - the window that used to be unguarded. */
  const stalledBody = (): FetchFn => async () =>
    ({
      status: 200,
      ok: true,
      json: () => new Promise(() => {}),
      text: () => new Promise(() => {}),
    }) as unknown as Response;

  it('is bounded by the call timeout rather than hanging forever', async () => {
    const http = createHttp({ fetchFn: stalledBody(), retries: 0, timeoutMs: 60_000 });
    const started = Date.now();

    await expect(http.getJson('https://example.test/x', { timeoutMs: 120 })).rejects.toBeInstanceOf(
      HttpError,
    );
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('is aborted by a stop, which previously could not reach it', async () => {
    const http = createHttp({ fetchFn: stalledBody(), retries: 0, timeoutMs: 60_000 });
    const cancel = new CancelToken();

    const started = Date.now();
    const pending = http.getText('https://example.test/x', { signal: cancel.signal });
    cancel.cancel();

    await expect(pending).rejects.toSatisfy(isCancelled);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('mapLimit stops its whole pool on the first failure', () => {
  it('starts no further items and settles only once every worker has stopped', async () => {
    const started: number[] = [];
    const items = Array.from({ length: 40 }, (_, i) => i);

    await expect(
      mapLimit(items, 4, async (n) => {
        started.push(n);
        // Item 2 fails once the pool is saturated.
        if (n === 2) throw new Error('boom');
        await new Promise((r) => setTimeout(r, 5));
        return n;
      }),
    ).rejects.toThrow('boom');

    // Without a shared stop the survivors kept pulling work - and kept
    // reporting progress - after the caller had already given up on them.
    const afterSettle = started.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(started.length).toBe(afterSettle);
    expect(started.length).toBeLessThan(items.length);
  });
});
