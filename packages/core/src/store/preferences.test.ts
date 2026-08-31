import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, createPreferenceStore, mergePreferences } from './preferences';
import type { FsAdapter } from './types';

/** In-memory adapter so these tests exercise the store, not the filesystem. */
function memoryFs(seed: Record<string, string> = {}): FsAdapter {
  const files = new Map(Object.entries(seed));
  return {
    async readText(path) {
      return files.get(path) ?? null;
    },
    async writeText(path, contents) {
      files.set(path, contents);
    },
    async mkdir() {},
    async listDirs() {
      return [];
    },
    async remove(path) {
      files.delete(path);
    },
  };
}

const PATH = 'preferences.json';

describe('mergePreferences', () => {
  it('returns the full default set when nothing is stored', () => {
    expect(mergePreferences(null)).toEqual(DEFAULT_PREFERENCES);
  });

  it('fills in a key added after the document was written', () => {
    const stored = { theme: 'dark' as const };
    const merged = mergePreferences(stored);
    expect(merged.theme).toBe('dark');
    expect(merged.viewMode).toBe(DEFAULT_PREFERENCES.viewMode);
    expect(merged.callingWindow).toEqual(DEFAULT_PREFERENCES.callingWindow);
  });

  it('does not let a stored partial drop sibling keys', () => {
    const merged = mergePreferences({ sidebarCollapsed: true });
    expect(Object.keys(merged).sort()).toEqual(Object.keys(DEFAULT_PREFERENCES).sort());
  });
});

describe('createPreferenceStore', () => {
  it('loads defaults when no document exists', async () => {
    const store = createPreferenceStore(memoryFs());
    expect(await store.load()).toEqual(DEFAULT_PREFERENCES);
  });

  it('round-trips a written preference', async () => {
    const store = createPreferenceStore(memoryFs());
    await store.save({ ...DEFAULT_PREFERENCES, theme: 'light', mapHeightPct: 30 });
    const loaded = await store.load();
    expect(loaded.theme).toBe('light');
    expect(loaded.mapHeightPct).toBe(30);
  });

  it('returns defaults rather than throwing on a malformed document', async () => {
    const store = createPreferenceStore(memoryFs({ [PATH]: '{ not json' }));
    expect(await store.load()).toEqual(DEFAULT_PREFERENCES);
  });

  it('returns defaults when the stored document is not an object', async () => {
    const store = createPreferenceStore(memoryFs({ [PATH]: '"a string"' }));
    expect(await store.load()).toEqual(DEFAULT_PREFERENCES);
  });

  it('clamps a stored map height back inside its bounds', async () => {
    const store = createPreferenceStore(memoryFs({ [PATH]: JSON.stringify({ mapHeightPct: 999 }) }));
    const loaded = await store.load();
    expect(loaded.mapHeightPct).toBeLessThanOrEqual(80);
    expect(loaded.mapHeightPct).toBeGreaterThanOrEqual(15);
  });
});
