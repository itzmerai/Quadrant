import { useEffect, useRef, useState } from 'react';
import { SPECIALTY_GROUPS, areaKm2, formatBBox, presetKeys, type BBox } from '@quadrant/core';

interface Props {
  bbox: BBox;
  zipCount: number;
  onCancel: () => void;
  onCreate: (name: string, specialties: string[]) => void;
}

export function NameBoxDialog({ bbox, zipCount, onCancel, onCreate }: Props) {
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>(presetKeys());
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const toggle = (key: string) =>
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));

  // A box outside the US can never return anything, so it is not creatable.
  const outsideCoverage = zipCount === 0;
  const valid = name.trim().length > 0 && picked.length > 0 && !outsideCoverage;
  const area = Math.round(areaKm2(bbox));

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-box-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="name-box-title">Name this box</h2>
        <p className="modal-sub">
          Everything found inside it is saved under this name.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onCreate(name, picked);
          }}
        >
          <label className="field">
            <span>Box name</span>
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Scottsdale Dentists"
              maxLength={60}
            />
          </label>

          <div className="box-facts">
            <div>
              <span className="k">Area</span>
              <span className="v tnum">{area.toLocaleString()} km²</span>
            </div>
            <div>
              <span className="k">ZIP codes</span>
              <span className="v tnum">{zipCount}</span>
            </div>
            <div className="wide">
              <span className="k">Coordinates</span>
              <span className="v coord">{formatBBox(bbox)}</span>
            </div>
          </div>

          {outsideCoverage && (
            <div className="blocker" role="alert">
              <strong>This box is outside the United States.</strong>
              <p>
                Quadrant searches the US federal provider registry, which is the only
                source that carries a phone number and a named contact for every
                practice. A box here would come back empty.
              </p>
              <p>Close this and draw a box over a US city instead.</p>
            </div>
          )}

          <fieldset className="specs">
            <legend>Which practices to look for</legend>
            <div className="spec-grid">
              {SPECIALTY_GROUPS.map((g) => (
                <label key={g.key} className={'spec' + (picked.includes(g.key) ? ' on' : '')}>
                  <input
                    type="checkbox"
                    checked={picked.includes(g.key)}
                    onChange={() => toggle(g.key)}
                  />
                  <span className="spec-label">{g.label}</span>
                  <span className="spec-hint">{g.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={!valid}>
              Create box
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
