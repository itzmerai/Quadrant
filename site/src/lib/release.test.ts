import { describe, expect, it } from 'vitest';
import {
  DOWNLOAD_URL,
  latestRelease,
  normaliseVersion,
  parseChecksum,
  networkFetchers,
  type Fetchers,
} from './release';

const FALLBACK = '0.1.0';

/** A fetcher pair that resolves whatever the test hands it. */
function fetchers(over: Partial<Fetchers>): Fetchers {
  return {
    json: over.json ?? (async () => { throw new Error('no json fetcher'); }),
    text: over.text ?? (async () => { throw new Error('no text fetcher'); }),
  };
}

const RELEASE = {
  tag_name: 'v0.2.0',
  published_at: '2026-09-01T10:00:00Z',
  assets: [
    { name: 'Quadrant_0.2.0_x64-setup.exe', browser_download_url: 'https://example.test/a' },
    { name: 'SHA256SUMS.txt', browser_download_url: 'https://example.test/sums' },
  ],
};

const HASH = 'a'.repeat(64);

describe('parseChecksum', () => {
  it('reads the hash out of sha256sum output', () => {
    expect(parseChecksum(`${HASH}  Quadrant_0.2.0_x64-setup.exe`)).toBe(HASH);
  });

  it('lowercases an uppercase hash', () => {
    expect(parseChecksum(`${'A'.repeat(64)}  installer.exe`)).toBe('a'.repeat(64));
  });

  it('returns null when the body holds no hash', () => {
    expect(parseChecksum('no hash here at all')).toBeNull();
  });

  it('does not match a hex run shorter than 64 characters', () => {
    expect(parseChecksum(`${'a'.repeat(40)}  installer.exe`)).toBeNull();
  });

  it('picks the installer line when several files are listed', () => {
    const body = [
      `${'b'.repeat(64)}  Quadrant_0.2.0_x64.msi`,
      `${'c'.repeat(64)}  Quadrant_0.2.0_x64-setup.exe`,
    ].join('\n');
    expect(parseChecksum(body, '-setup.exe')).toBe('c'.repeat(64));
  });

  it('falls back to the first hash when no line matches the wanted suffix', () => {
    const body = `${'d'.repeat(64)}  something-else.zip`;
    expect(parseChecksum(body, '-setup.exe')).toBe('d'.repeat(64));
  });
});

describe('normaliseVersion', () => {
  it('strips a leading v', () => {
    expect(normaliseVersion('v0.2.0')).toBe('0.2.0');
  });

  it('leaves a bare version unchanged', () => {
    expect(normaliseVersion('0.2.0')).toBe('0.2.0');
  });

  it('strips an uppercase V', () => {
    expect(normaliseVersion('V1.0.0')).toBe('1.0.0');
  });
});

describe('latestRelease', () => {
  it('reports a live release with version, date and hash', async () => {
    const info = await latestRelease(
      fetchers({
        json: async () => RELEASE,
        text: async () => `${HASH}  Quadrant_0.2.0_x64-setup.exe`,
      }),
      FALLBACK,
    );
    expect(info.state).toBe('live');
    expect(info.version).toBe('0.2.0');
    expect(info.publishedAt).toBe('2026-09-01T10:00:00Z');
    expect(info.sha256).toBe(HASH);
    expect(info.live).toBe(true);
  });

  it('stays live with a null hash when no checksum asset was published', async () => {
    const info = await latestRelease(
      fetchers({ json: async () => ({ ...RELEASE, assets: [RELEASE.assets[0]] }) }),
      FALLBACK,
    );
    expect(info.state).toBe('live');
    expect(info.version).toBe('0.2.0');
    expect(info.sha256).toBeNull();
  });

  it('reports no release when GitHub answers with nothing published', async () => {
    const info = await latestRelease(
      fetchers({ json: async () => null }),
      FALLBACK,
    );
    expect(info.state).toBe('none');
    expect(info.version).toBe(FALLBACK);
    expect(info.sha256).toBeNull();
    expect(info.live).toBe(false);
  });

  it('reports unreachable — not none — when the request fails', async () => {
    const info = await latestRelease(
      fetchers({ json: async () => { throw new Error('offline'); } }),
      FALLBACK,
    );
    expect(info.state).toBe('unreachable');
    expect(info.version).toBe(FALLBACK);
    expect(info.live).toBe(false);
  });

  it('never throws, whatever the fetchers do', async () => {
    await expect(
      latestRelease(
        fetchers({ json: async () => { throw new Error('boom'); }, text: async () => { throw new Error('boom'); } }),
        FALLBACK,
      ),
    ).resolves.toBeDefined();
  });

  it('stays live when the checksum asset exists but cannot be read', async () => {
    const info = await latestRelease(
      fetchers({
        json: async () => RELEASE,
        text: async () => { throw new Error('asset fetch failed'); },
      }),
      FALLBACK,
    );
    expect(info.state).toBe('live');
    expect(info.sha256).toBeNull();
  });

  it('treats a release with no tag as nothing published', async () => {
    const info = await latestRelease(
      fetchers({ json: async () => ({ published_at: '2026-09-01T10:00:00Z' }) }),
      FALLBACK,
    );
    expect(info.state).toBe('none');
  });

  it('keeps the download URL identical in every state', async () => {
    const live = await latestRelease(
      fetchers({ json: async () => RELEASE, text: async () => `${HASH}  x-setup.exe` }),
      FALLBACK,
    );
    const dead = await latestRelease(
      fetchers({ json: async () => { throw new Error('offline'); } }),
      FALLBACK,
    );
    // The link is a permalink, never derived from the response (KTD5).
    expect(DOWNLOAD_URL).toContain('releases/latest/download');
    expect(live.state).not.toBe(dead.state);
  });
});

/**
 * These cover the HTTP layer the injected-fetcher tests above cannot reach.
 * The 404-means-nothing-published distinction lives here, and a build against
 * a release-less repo reported "unreachable" until it was covered.
 */
describe('networkFetchers', () => {
  const res = (status: number, body: unknown = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => String(body),
  });

  it('treats a 404 from the release endpoint as nothing published, not an error', async () => {
    const f = networkFetchers(undefined, async () => res(404));
    await expect(f.json('https://api.test/latest')).resolves.toBeNull();
  });

  it('surfaces a 404 as state none, never unreachable', async () => {
    const f = networkFetchers(undefined, async () => res(404));
    const info = await latestRelease(f, FALLBACK);
    expect(info.state).toBe('none');
  });

  it('throws on a server error so the caller reports unreachable', async () => {
    const f = networkFetchers(undefined, async () => res(503));
    await expect(f.json('https://api.test/latest')).rejects.toThrow('HTTP 503');
  });

  it('maps a rate-limit response to unreachable rather than none', async () => {
    const f = networkFetchers(undefined, async () => res(403));
    const info = await latestRelease(f, FALLBACK);
    expect(info.state).toBe('unreachable');
  });

  it('sends an auth header only when a token is supplied', async () => {
    const seen: Array<Record<string, string> | undefined> = [];
    const capture: Parameters<typeof networkFetchers>[1] = async (_u, init) => {
      seen.push(init?.headers);
      return res(200, { tag_name: 'v1.0.0' });
    };
    await networkFetchers('tok', capture).json('https://api.test/latest');
    await networkFetchers(undefined, capture).json('https://api.test/latest');
    expect(seen[0]?.Authorization).toBe('Bearer tok');
    expect(seen[1]?.Authorization).toBeUndefined();
  });
});
