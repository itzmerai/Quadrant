import { useEffect } from 'react';
import { SPECIALTY_GROUPS, type HuntEffort, type ThemeChoice } from '@quadrant/core';
import { usePreferences } from '../lib/PreferencesContext';
import { IS_TAURI, STORAGE_LABEL, dataFolderPath, openDataFolder } from '../lib/runtime';

const THEMES: Array<{ value: ThemeChoice; label: string }> = [
  { value: 'system', label: 'Follow system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const EFFORTS: Array<{ value: HuntEffort; label: string; hint: string }> = [
  { value: 'quick', label: 'Quick', hint: 'Homepage and contact page only. Fastest, finds least.' },
  { value: 'balanced', label: 'Balanced', hint: 'Adds the usual about and appointment pages.' },
  { value: 'thorough', label: 'Thorough', hint: 'Also guesses domains for practices with no known site. Slowest.' },
];

const DAYS = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

function hourLabel(h: number): string {
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  if (h === 24) return 'midnight';
  return h < 12 ? h + ' AM' : (h - 12) + ' PM';
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { prefs, update } = usePreferences();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const win = prefs.callingWindow;
  const windowInvalid = !(win.endHour > win.startHour);

  const toggleDay = (d: number) => {
    const days = win.days.includes(d) ? win.days.filter((x) => x !== d) : [...win.days, d].sort();
    update({ callingWindow: { ...win, days } });
  };

  const toggleSpecialty = (key: string) => {
    const next = prefs.defaultSpecialties.includes(key)
      ? prefs.defaultSpecialties.filter((k) => k !== key)
      : [...prefs.defaultSpecialties, key];
    if (next.length) update({ defaultSpecialties: next });
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="settings-title">Settings</h2>
        <p className="modal-sub">These apply across every box.</p>

        <section className="set-group">
          <h3>Appearance</h3>
          <div className="seg">
            {THEMES.map((t) => (
              <button
                key={t.value}
                className={'seg-btn' + (prefs.theme === t.value ? ' on' : '')}
                onClick={() => update({ theme: t.value })}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="set-hint">The map follows this too.</p>
        </section>

        <section className="set-group">
          <h3>When you call</h3>
          <p className="set-hint">
            Sets what &ldquo;Open now&rdquo; means. These are hours at the practice, not where you are.
          </p>
          <div className="set-row">
            <label>
              <span>From</span>
              <select
                value={win.startHour}
                onChange={(e) => update({ callingWindow: { ...win, startHour: Number(e.target.value) } })}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{hourLabel(h)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Until</span>
              <select
                value={win.endHour}
                onChange={(e) => update({ callingWindow: { ...win, endHour: Number(e.target.value) } })}
              >
                {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                  <option key={h} value={h}>{hourLabel(h)}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="daypick">
            {DAYS.map((d) => (
              <button
                key={d.value}
                className={'day' + (win.days.includes(d.value) ? ' on' : '')}
                onClick={() => toggleDay(d.value)}
                aria-pressed={win.days.includes(d.value)}
              >
                {d.label}
              </button>
            ))}
          </div>
          {windowInvalid && (
            <p className="warn">
              The end time must be later than the start. Overnight windows are not supported,
              so nothing counts as open until this is fixed.
            </p>
          )}
        </section>

        <section className="set-group">
          <h3>New boxes start with</h3>
          <p className="set-hint">Pre-ticked when you name a box. Existing boxes keep what they were scanned with.</p>
          <div className="chips">
            {SPECIALTY_GROUPS.map((g) => (
              <button
                key={g.key}
                className={'chip' + (prefs.defaultSpecialties.includes(g.key) ? ' on' : '')}
                onClick={() => toggleSpecialty(g.key)}
                aria-pressed={prefs.defaultSpecialties.includes(g.key)}
                title={g.hint}
              >
                {g.label}
              </button>
            ))}
          </div>
        </section>

        <section className="set-group">
          <h3>Finding emails</h3>
          <div className="seg">
            {EFFORTS.map((e) => (
              <button
                key={e.value}
                className={'seg-btn' + (prefs.huntEffort === e.value ? ' on' : '')}
                onClick={() => update({ huntEffort: e.value })}
                title={e.hint}
              >
                {e.label}
              </button>
            ))}
          </div>
          <p className="set-hint">{EFFORTS.find((e) => e.value === prefs.huntEffort)?.hint}</p>
          <label className="set-check">
            <input
              type="checkbox"
              checked={prefs.allowGuessedEmails}
              onChange={(e) => update({ allowGuessedEmails: e.target.checked })}
            />
            <span>
              Include guessed addresses
              <span className="set-hint">
                Adds <code>info@</code> for practices that publish none but whose domain accepts mail.
                Likely right, but can bounce — turn this off if bounces matter to you.
              </span>
            </span>
          </label>
        </section>

        <section className="set-group">
          <h3>Your data</h3>
          <p className="set-hint">{STORAGE_LABEL}</p>
          <p className="coord datapath">{dataFolderPath()}</p>
          {IS_TAURI && (
            <button className="btn" onClick={() => void openDataFolder()}>
              Open data folder
            </button>
          )}
        </section>

        <div className="modal-actions">
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
