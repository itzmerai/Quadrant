import { useCallback, useEffect, useRef } from 'react';
import { MAP_HEIGHT_MAX, MAP_HEIGHT_MIN } from '@quadrant/core';

interface Props {
  /** Height of the pane the map sits in, used to convert pixels to percent. */
  containerRef: React.RefObject<HTMLElement | null>;
  onResize: (pct: number) => void;
  onCommit: (pct: number) => void;
}

/**
 * Drag handle on the map's bottom edge.
 *
 * Pointer capture is what makes an interrupted drag safe: the pointer stays
 * bound to this element even when it leaves the window, so the release always
 * lands here and the map can never stick at a partial height.
 */
export function MapResizer({ containerRef, onResize, onCommit }: Props) {
  const draggingRef = useRef(false);
  const latestRef = useRef<number | null>(null);

  const pctFromEvent = useCallback(
    (clientY: number): number | null => {
      const host = containerRef.current;
      if (!host) return null;
      const rect = host.getBoundingClientRect();
      if (rect.height <= 0) return null;
      const raw = ((clientY - rect.top) / rect.height) * 100;
      return Math.min(MAP_HEIGHT_MAX, Math.max(MAP_HEIGHT_MIN, raw));
    },
    [containerRef],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const pct = pctFromEvent(e.clientY);
    if (pct === null) return;
    latestRef.current = pct;
    onResize(pct);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* capture already gone */
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (latestRef.current !== null) onCommit(latestRef.current);
  };

  // A drag still live when this unmounts would leave the cursor overridden.
  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  /** Keyboard parity, so the split is not mouse-only. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const host = containerRef.current;
    if (!host) return;
    const step = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const current = (host.querySelector('.map-host') as HTMLElement | null)?.offsetHeight ?? 0;
      const pct = (current / host.getBoundingClientRect().height) * 100;
      const next = Math.min(
        MAP_HEIGHT_MAX,
        Math.max(MAP_HEIGHT_MIN, pct + (e.key === 'ArrowUp' ? -step : step)),
      );
      onResize(next);
      onCommit(next);
    }
  };

  return (
    <div
      className="map-resizer"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize map"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      <span className="map-resizer-grip" aria-hidden="true" />
    </div>
  );
}
