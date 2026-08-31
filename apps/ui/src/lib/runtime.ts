import { createHttp, type Http } from '@quadrant/core';
import type { FsAdapter } from '@quadrant/core';

/** True when running inside the Tauri shell rather than a plain browser tab. */
export const IS_TAURI =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * In Tauri, requests go through Rust and CORS does not apply.
 * In browser dev, they go through the Vite proxies declared in vite.config.ts.
 */
function proxyRewrite(url: string): string {
  return url
    .replace('https://npiregistry.cms.hhs.gov/api/', '/api/nppes/')
    .replace('https://overpass-api.de/api/interpreter', '/api/overpass');
}

let httpSingleton: Http | null = null;

export async function getHttp(): Promise<Http> {
  if (httpSingleton) return httpSingleton;

  if (IS_TAURI) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    httpSingleton = createHttp({
      fetchFn: (url, init) => tauriFetch(url, init as RequestInit),
      timeoutMs: 25_000,
      retries: 2,
    });
  } else {
    httpSingleton = createHttp({
      rewriteUrl: proxyRewrite,
      timeoutMs: 25_000,
      retries: 2,
    });
  }
  return httpSingleton;
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

/**
 * Browser fallback so `npm run dev` is fully usable without a Rust build.
 * Paths are flattened into localStorage keys; directories are implied by
 * key prefixes.
 */
function localStorageAdapter(): FsAdapter {
  const PREFIX = 'quadrant:';
  return {
    async readText(path) {
      return localStorage.getItem(PREFIX + path);
    },
    async writeText(path, contents) {
      localStorage.setItem(PREFIX + path, contents);
    },
    async mkdir() {
      /* directories are implicit in a flat key space */
    },
    async listDirs(path) {
      const base = PREFIX + path + '/';
      const seen = new Set<string>();
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(base)) continue;
        const rest = key.slice(base.length);
        const dir = rest.split('/')[0];
        if (dir) seen.add(dir);
      }
      return [...seen];
    },
    async remove(path) {
      const target = PREFIX + path;
      const doomed: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key === target || key.startsWith(target + '/'))) doomed.push(key);
      }
      for (const k of doomed) localStorage.removeItem(k);
    },
  };
}

/** Real files under the OS app-data directory, via the Tauri fs plugin. */
async function tauriAdapter(): Promise<FsAdapter> {
  const fs = await import('@tauri-apps/plugin-fs');
  const base = fs.BaseDirectory.AppData;

  return {
    async readText(path) {
      try {
        if (!(await fs.exists(path, { baseDir: base }))) return null;
        return await fs.readTextFile(path, { baseDir: base });
      } catch {
        return null;
      }
    },
    async writeText(path, contents) {
      await fs.writeTextFile(path, contents, { baseDir: base });
    },
    async mkdir(path) {
      try {
        await fs.mkdir(path, { baseDir: base, recursive: true });
      } catch {
        /* already exists */
      }
    },
    async listDirs(path) {
      try {
        const entries = await fs.readDir(path, { baseDir: base });
        return entries.filter((e) => e.isDirectory).map((e) => e.name);
      } catch {
        return [];
      }
    },
    async remove(path) {
      try {
        await fs.remove(path, { baseDir: base, recursive: true });
      } catch {
        /* nothing to remove */
      }
    },
  };
}

let fsSingleton: FsAdapter | null = null;

export async function getFs(): Promise<FsAdapter> {
  if (fsSingleton) return fsSingleton;
  fsSingleton = IS_TAURI ? await tauriAdapter() : localStorageAdapter();
  return fsSingleton;
}

/** Where the user's data actually lives, for the UI to state plainly. */
export const STORAGE_LABEL = IS_TAURI
  ? 'Saved to your app data folder'
  : 'Saved in this browser (dev mode)';

/* ------------------------------------------------------------------ */
/* Data location                                                       */
/* ------------------------------------------------------------------ */

/**
 * Where the operator's boxes actually live, shown in Settings so the storage
 * location is not a mystery.
 */
export function dataFolderPath(): string {
  return IS_TAURI
    ? 'App data folder \u2192 Quadrant \u2192 territories'
    : 'Browser storage (dev mode) \u2014 not a folder on disk';
}

/** Reveal that folder in the OS file manager. Desktop only. */
export async function openDataFolder(): Promise<void> {
  if (!IS_TAURI) return;
  try {
    const [{ appDataDir }, { openPath }] = await Promise.all([
      import('@tauri-apps/api/path'),
      import('@tauri-apps/plugin-opener'),
    ]);
    await openPath(await appDataDir());
  } catch {
    /* nothing sensible to do if the OS refuses */
  }
}
