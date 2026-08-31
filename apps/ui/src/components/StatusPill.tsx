import type { CallStatus } from '@quadrant/core';

/**
 * Call status as a filled pill (R5).
 *
 * All eight states carry a distinct treatment — previously only three did, so
 * scanning the sheet for who still needs calling meant reading every row.
 *
 * The pill *is* the select rather than an invisible select layered over a
 * span. The overlay version flickered: the native dropdown anchors to an
 * absolutely-positioned element inside a fixed-height cell with
 * `overflow: hidden`, and the popup fought that clipping every frame.
 *
 * The glyph rides in the option text, so the encoding never depends on colour
 * alone and survives dark mode and colour-blind viewing.
 */

export const STATUSES: CallStatus[] = [
  'new', 'no-answer', 'follow-up', 'interested', 'do-not-contact',
];

export const STATUS_LABEL: Record<CallStatus, string> = {
  'new': 'New',
  'no-answer': 'No answer',
  'follow-up': 'Follow up',
  'interested': 'Interested',
  'do-not-contact': 'Do not contact',
};

const STATUS_GLYPH: Record<CallStatus, string> = {
  'new': '●',
  'no-answer': '◌',
  'follow-up': '↻',
  'interested': '★',
  'do-not-contact': '⊘',
};

interface Props {
  value: CallStatus;
  onChange: (next: CallStatus) => void;
}

export function StatusPill({ value, onChange }: Props) {
  return (
    <select
      className={'pill s-' + value}
      value={value}
      onChange={(e) => onChange(e.target.value as CallStatus)}
      aria-label="Call status"
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_GLYPH[s] + '  ' + STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}
