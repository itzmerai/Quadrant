import { useEffect, useRef, useState } from 'react';
import {
  isOfficeHours,
  localTimeAt,
  scoreBand,
  type CallingWindow,
  type CallStatus,
  type Lead,
} from '@quadrant/core';
import { computeWindow } from './leadWindow';
import { StatusPill } from './StatusPill';

interface Props {
  leads: Lead[];
  onPatch: (leadId: string, patch: Partial<Lead>) => void;
  callingWindow: CallingWindow;
  now: Date;
}

/**
 * The roomier view of the same call sheet.
 *
 * Windowed like the list is — a card grid holding thousands of practices would
 * reproduce the freeze the list view was rebuilt to avoid. Cards are a fixed
 * height and the column count comes from the measured width, which is the only
 * thing that differs from the list's arithmetic (KTD4).
 */
const CARD_H = 168;
const CARD_MIN_W = 268;
const GRID_GAP = 12;
const OVERSCAN = 2;

export function LeadCards({ leads, onPatch, callingWindow, now }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  const [perRow, setPerRow] = useState(3);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const apply = () => {
      const h = el.clientHeight;
      const w = el.clientWidth;
      if (h) setViewportH((prev) => (prev === h ? prev : h));
      if (w) {
        const cols = Math.max(1, Math.floor((w + GRID_GAP) / (CARD_MIN_W + GRID_GAP)));
        setPerRow((prev) => (prev === cols ? prev : cols));
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rowHeight = CARD_H + GRID_GAP;
  const win = computeWindow({
    itemHeight: rowHeight,
    perRow,
    overscan: OVERSCAN,
    count: leads.length,
    scrollTop,
    viewportH,
  });

  const windowed = leads.slice(win.first, win.last);

  return (
    <div
      className="cards-scroll"
      ref={scrollRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: win.padTop }} />
      <div
        className="cards-grid"
        style={{ gridTemplateColumns: 'repeat(' + perRow + ', minmax(0, 1fr))' }}
      >
        {windowed.map((l) => {
          const open = isOfficeHours(l.timezone, callingWindow, now);
          return (
            <article key={l.id} className={'lead-card ' + scoreBand(l.score)}>
              <header className="lc-head">
                <span className={'score ' + scoreBand(l.score)}>{l.score}</span>
                <h4 title={l.practiceName}>{l.practiceName}</h4>
              </header>

              <p className="lc-sub">
                {[l.city, l.state].filter(Boolean).join(', ')}
                {l.relatedCount ? ' · +' + l.relatedCount + ' here' : ''}
              </p>

              <dl className="lc-fields">
                <dt>Call</dt>
                <dd className="tnum">
                  {l.phone
                    ? <a href={'tel:' + l.phone.replace(/\\D/g, '')}>{l.phone}</a>
                    : <span className="muted">—</span>}
                </dd>

                <dt>Ask for</dt>
                <dd>{l.contactName ?? <span className="muted">—</span>}</dd>

                <dt>Their time</dt>
                <dd className="tnum">
                  {l.timezone
                    ? <span className={'clock' + (open ? ' open' : '')}>{localTimeAt(l.timezone, now)}</span>
                    : <span className="muted">—</span>}
                </dd>
              </dl>

              <footer className="lc-foot">
                <StatusPill
                  value={l.callStatus}
                  onChange={(next: CallStatus) =>
                    onPatch(l.id, { callStatus: next, lastCalledAt: new Date().toISOString() })
                  }
                />
              </footer>
            </article>
          );
        })}
      </div>
      <div style={{ height: win.padBottom }} />
    </div>
  );
}
