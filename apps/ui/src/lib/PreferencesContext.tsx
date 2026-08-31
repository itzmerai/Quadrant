import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_PREFERENCES,
  createPreferenceStore,
  type PreferenceStore,
  type Preferences,
} from '@quadrant/core';
import { getFs } from './runtime';

/**
 * Preferences load once and are held here, so no component races the async
 * read and flashes a default before the stored value arrives (KTD2).
 */

interface PreferencesValue {
  prefs: Preferences;
  /** Patch one or more keys. Persists immediately. */
  update: (patch: Partial<Preferences>) => void;
  /** Resolved theme after 'system' is decided, for consumers that need it. */
  resolvedTheme: 'light' | 'dark';
}

const Ctx = createContext<PreferencesValue | null>(null);

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    && !!window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * The stylesheet already branches on `data-theme` for all three states, so an
 * explicit choice sets the attribute and 'system' removes it (KTD3).
 */
function applyTheme(theme: Preferences['theme']) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [ready, setReady] = useState(false);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const storeRef = useRef<PreferenceStore | null>(null);
  /** Mirrors prefs so update() never has to read state inside an updater. */
  const latestRef = useRef<Preferences>(DEFAULT_PREFERENCES);

  useEffect(() => {
    (async () => {
      const store = createPreferenceStore(await getFs());
      storeRef.current = store;
      const loaded = await store.load();
      applyTheme(loaded.theme);
      latestRef.current = loaded;
      setPrefs(loaded);
      setReady(true);
    })().catch(() => {
      // A store that will not load must not block the app; run on defaults.
      applyTheme(DEFAULT_PREFERENCES.theme);
      setReady(true);
    });
  }, []);

  // 'system' has to keep tracking the OS after load, not just at startup.
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /**
   * Compute the next value outside the state updater. React may invoke an
   * updater more than once (StrictMode does), and writing to the DOM or to
   * disk from inside one fires those side effects repeatedly.
   */
  const update = useCallback((patch: Partial<Preferences>) => {
    const next = { ...latestRef.current, ...patch };
    latestRef.current = next;
    if (patch.theme !== undefined) applyTheme(next.theme);
    void storeRef.current?.save(next);
    setPrefs(next);
  }, []);

  const resolvedTheme: 'light' | 'dark' =
    prefs.theme === 'system' ? (systemDark ? 'dark' : 'light') : prefs.theme;

  const value = useMemo(
    () => ({ prefs, update, resolvedTheme }),
    [prefs, update, resolvedTheme],
  );

  // Render nothing until the stored values are in hand, so the shell does not
  // paint at the default map height and then jump.
  if (!ready) return null;

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePreferences(): PreferencesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePreferences must be used inside PreferencesProvider');
  return v;
}
