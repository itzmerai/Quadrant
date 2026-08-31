import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TERRITORY_COLORS, territoryColor } from '@quadrant/core';

interface Props {
  colorKey: string | undefined;
  theme: 'light' | 'dark';
  onPick: (colorKey: string) => void;
  onDelete: () => void;
}

/**
 * Per-box menu in the sidebar.
 *
 * The popover is position-fixed and placed from the trigger's bounding rect
 * rather than nested in the sidebar. The sidebar scrolls, so an in-flow
 * popover would be clipped by its `overflow` — the same trap that made the
 * status pill flicker.
 */
export function TerritoryMenu({ colorKey, theme, onPick, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const width = 196;
    setPos({
      top: Math.min(r.bottom + 6, window.innerHeight - 190),
      left: Math.min(r.left, window.innerWidth - width - 12),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Closing on scroll is simpler and less jarring than tracking the anchor.
    const onScroll = () => setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const current = territoryColor(colorKey);

  return (
    <>
      <button
        ref={btnRef}
        className={'terr-menu-btn' + (open ? ' open' : '')}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title="Box options"
        aria-label="Box options"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        &#8942;
      </button>

      {open && pos && (
        <div
          ref={popRef}
          className="terr-pop"
          role="menu"
          style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="terr-pop-head">Colour</p>
          <div className="swatches">
            {TERRITORY_COLORS.map((c) => {
              const hex = theme === 'dark' ? c.dark : c.light;
              const active = c.key === current.key;
              return (
                <button
                  key={c.key}
                  className={'swatch' + (active ? ' on' : '')}
                  style={{ background: hex }}
                  title={c.label}
                  aria-label={c.label}
                  aria-pressed={active}
                  onClick={() => {
                    onPick(c.key);
                    setOpen(false);
                  }}
                />
              );
            })}
          </div>

          <div className="terr-pop-sep" />
          <button
            className="terr-pop-item danger"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            Delete box
          </button>
        </div>
      )}
    </>
  );
}
