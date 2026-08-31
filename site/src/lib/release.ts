/**
 * Latest-release metadata, read at build time.
 *
 * The version and hash on the download page come from the published release
 * rather than a constant in this repo. A hardcoded version is correct on the
 * day it is written and quietly wrong afterwards — which on a page whose whole
 * job is letting people verify what they downloaded is worse than showing
 * nothing at all.
 *
 * The download *link* is deliberately not taken from here. It is GitHub's
 * `releases/latest/download` permalink, which stays correct between builds.
 * This module supplies what the permalink cannot: which version that currently
 * is, when it shipped, and its checksum.
 */

export const REPO = 'itzmerai/Quadrant';
export const REPO_URL = `https://github.com/${REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases`;

/**
 * The permalink resolves by asset *filename*, so the release workflow publishes
 * a version-free copy alongside Tauri's versioned output. Linking
 * `Quadrant_0.1.0_x64-setup.exe` directly would go stale on the next release.
 */
export const INSTALLER_NAME = 'Quadrant-setup.exe';
export const DOWNLOAD_URL = `${REPO_URL}/releases/latest/download/${INSTALLER_NAME}`;

/** Suffix identifying the installer line inside the checksum asset. */
export const INSTALLER_SUFFIX = '-setup.exe';

const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
const CHECKSUM_ASSET = 'SHA256SUMS.txt';

/**
 * Why there is no live release, when there isn't one.
 *
 * `none` and `unreachable` are different facts and the page says different
 * things about them. Claiming a network failure when GitHub answered fine and
 * simply has nothing published would be a lie on a page about honesty.
 */
export type ReleaseState = 'live' | 'none' | 'unreachable';

export interface ReleaseInfo {
  version: string;
  /** ISO timestamp, or null when the release could not be read. */
  publishedAt: string | null;
  /** Lowercase hex SHA-256, or null when no checksum was published. */
  sha256: string | null;
  /** True when this came from the API rather than the fallback. */
  live: boolean;
  state: ReleaseState;
  /**
   * Whether the installer asset is actually attached to this release.
   *
   * A published release is not the same thing as a downloadable one. A tag can
   * be pushed, or a draft published by hand, before the build that uploads the
   * binary has finished or succeeded — and `releases/latest/download/<name>`
   * 404s in that window. Offering a download button then sends people to a
   * GitHub error page, so every download link is gated on this rather than on
   * `state === 'live'`.
   */
  hasInstaller: boolean;
}

interface GitHubAsset {
  name?: string;
  browser_download_url?: string;
}

interface GitHubRelease {
  tag_name?: string;
  published_at?: string;
  assets?: GitHubAsset[];
}

/** Both network calls this module makes, injected so the tests need none. */
export interface Fetchers {
  json: (url: string) => Promise<unknown>;
  text: (url: string) => Promise<string>;
}

/**
 * Pulls the SHA-256 out of a `SHA256SUMS.txt` body.
 *
 * The format is what `sha256sum` emits: hash, whitespace, filename. When the
 * asset lists several files, prefer the line naming the installer — picking the
 * first line blindly would show the hash of the wrong artifact.
 */
export function parseChecksum(body: string, wantSuffix = INSTALLER_SUFFIX): string | null {
  const lines = body.split(/\r?\n/);
  const hashOn = (line: string) => /\b([0-9a-f]{64})\b/i.exec(line)?.[1]?.toLowerCase() ?? null;

  for (const line of lines) {
    if (line.toLowerCase().includes(wantSuffix.toLowerCase())) {
      const hit = hashOn(line);
      if (hit) return hit;
    }
  }
  // No line named the installer; fall back to the first hash present.
  for (const line of lines) {
    const hit = hashOn(line);
    if (hit) return hit;
  }
  return null;
}

/** Strips a leading `v` so the page shows `0.2.0`, not `v0.2.0`. */
export function normaliseVersion(tag: string): string {
  return tag.replace(/^v/i, '');
}

/**
 * Reads the latest release.
 *
 * Never throws. A site build must not fail because GitHub was briefly
 * unreachable or rate-limited — the page falls back to the version this repo
 * declares and omits the hash, which is honest about what it does and does not
 * know.
 */
export async function latestRelease(
  fetchers: Fetchers,
  fallbackVersion: string,
): Promise<ReleaseInfo> {
  const fallback = (state: ReleaseState): ReleaseInfo => ({
    version: fallbackVersion,
    publishedAt: null,
    sha256: null,
    live: false,
    state,
    hasInstaller: false,
  });

  let raw: unknown;
  try {
    raw = await fetchers.json(API_LATEST);
  } catch {
    return fallback('unreachable');
  }

  if (!raw || typeof raw !== 'object') return fallback('none');

  const release = raw as GitHubRelease;
  if (!release.tag_name) return fallback('none');

  const assets = release.assets ?? [];
  const sums = assets.find((a) => a.name === CHECKSUM_ASSET);
  const hasInstaller = assets.some((a) => a.name === INSTALLER_NAME);

  let sha256: string | null = null;
  if (sums?.browser_download_url) {
    try {
      sha256 = parseChecksum(await fetchers.text(sums.browser_download_url));
    } catch {
      // The release is real even when its checksum asset cannot be read; the
      // page omits the hash rather than downgrading the whole state.
      sha256 = null;
    }
  }

  return {
    version: normaliseVersion(release.tag_name),
    publishedAt: release.published_at ?? null,
    sha256,
    live: true,
    state: 'live',
    hasInstaller,
  };
}

/** Minimal shape of the fetch this module needs, so it can be injected. */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;

/**
 * The fetchers used at build time.
 *
 * A 404 from the latest-release endpoint is **not** a failure: GitHub answers
 * that way when a repo simply has no releases yet. Throwing on it would report
 * "GitHub unreachable" for a repo GitHub answered about perfectly well, which
 * is the exact confusion the three release states exist to avoid. Only a real
 * transport or server failure becomes an error.
 */
export function networkFetchers(token?: string, impl?: FetchLike): Fetchers {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'quadrant-site-build',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const doFetch: FetchLike = impl ?? (fetch as unknown as FetchLike);

  return {
    async json(url) {
      const res = await doFetch(url, { headers });
      // Nothing published. Resolve to null so the caller reports 'none'.
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    async text(url) {
      const res = await doFetch(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    },
  };
}
