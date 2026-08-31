import type { FsAdapter } from './types';
import { presetKeys } from '../taxonomy';

/**
 * App-level settings, distinct from the per-territory data next to it.
 *
 * Stored as one JSON document through the same FsAdapter the territory store
 * uses, so it resolves to real files in the desktop app and localStorage in
 * browser dev without a second persistence layer (KTD1).
 */

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ViewMode = 'list' | 'cards';

/**
 * How hard the email hunt tries. Named levels rather than a concurrency
 * number: the operator can judge "thorough costs more time", not whether six
 * parallel fetches is correct.
 */
export type HuntEffort = 'quick' | 'balanced' | 'thorough';

export interface CallingWindow {
  /** Local hour at the practice when calling may start, 0-23. */
  startHour: number;
  /** Local hour at the practice when calling must stop, 1-24. */
  endHour: number;
  /** Days that count as callable. 0 = Sunday. */
  days: number[];
}

export interface Preferences {
  theme: ThemeChoice;
  sidebarCollapsed: boolean;
  /** Map height as a percentage of the main pane. */
  mapHeightPct: number;
  mapClosed: boolean;
  viewMode: ViewMode;
  /** Specialty group keys pre-ticked when a new box is named. */
  defaultSpecialties: string[];
  callingWindow: CallingWindow;
  /** IANA zone the operator works from. Their own clock, not the practice's. */
  homeTimezone: string | null;
  huntEffort: HuntEffort;
  /** Whether the email hunt may infer an address the practice never published. */
  allowGuessedEmails: boolean;
}

export const MAP_HEIGHT_MIN = 15;
export const MAP_HEIGHT_MAX = 80;

export const DEFAULT_CALLING_WINDOW: CallingWindow = {
  startHour: 9,
  endHour: 17,
  days: [1, 2, 3, 4, 5],
};

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  sidebarCollapsed: false,
  mapHeightPct: 46,
  mapClosed: false,
  viewMode: 'list',
  defaultSpecialties: presetKeys(),
  callingWindow: DEFAULT_CALLING_WINDOW,
  homeTimezone: null,
  huntEffort: 'balanced',
  allowGuessedEmails: true,
};

const FILE = 'preferences.json';

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Merge a stored document over the defaults.
 *
 * A build that adds a preference must still read a document written before it
 * existed, so every key falls back rather than arriving undefined.
 */
export function mergePreferences(stored: unknown): Preferences {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return { ...DEFAULT_PREFERENCES };
  }
  const s = stored as Partial<Preferences>;

  const window = s.callingWindow;
  const callingWindow: CallingWindow =
    window && typeof window === 'object'
      ? {
          startHour: clamp(Number(window.startHour ?? DEFAULT_CALLING_WINDOW.startHour), 0, 23),
          endHour: clamp(Number(window.endHour ?? DEFAULT_CALLING_WINDOW.endHour), 1, 24),
          days: Array.isArray(window.days) ? window.days : DEFAULT_CALLING_WINDOW.days,
        }
      : { ...DEFAULT_CALLING_WINDOW };

  return {
    theme: s.theme ?? DEFAULT_PREFERENCES.theme,
    sidebarCollapsed: s.sidebarCollapsed ?? DEFAULT_PREFERENCES.sidebarCollapsed,
    mapHeightPct: clamp(
      Number(s.mapHeightPct ?? DEFAULT_PREFERENCES.mapHeightPct),
      MAP_HEIGHT_MIN,
      MAP_HEIGHT_MAX,
    ),
    mapClosed: s.mapClosed ?? DEFAULT_PREFERENCES.mapClosed,
    viewMode: s.viewMode ?? DEFAULT_PREFERENCES.viewMode,
    defaultSpecialties:
      Array.isArray(s.defaultSpecialties) && s.defaultSpecialties.length
        ? s.defaultSpecialties
        : DEFAULT_PREFERENCES.defaultSpecialties,
    callingWindow,
    homeTimezone: s.homeTimezone ?? DEFAULT_PREFERENCES.homeTimezone,
    huntEffort: s.huntEffort ?? DEFAULT_PREFERENCES.huntEffort,
    allowGuessedEmails: s.allowGuessedEmails ?? DEFAULT_PREFERENCES.allowGuessedEmails,
  };
}

export interface PreferenceStore {
  load(): Promise<Preferences>;
  save(prefs: Preferences): Promise<void>;
}

export function createPreferenceStore(fs: FsAdapter): PreferenceStore {
  return {
    async load() {
      try {
        const raw = await fs.readText(FILE);
        if (!raw) return { ...DEFAULT_PREFERENCES };
        return mergePreferences(JSON.parse(raw));
      } catch {
        // A corrupt document must not lock the operator out of their app.
        return { ...DEFAULT_PREFERENCES };
      }
    },

    async save(prefs) {
      await fs.writeText(FILE, JSON.stringify(prefs, null, 2));
    },
  };
}
