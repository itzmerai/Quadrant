import { CALL_STATUSES, type CallStatus } from '@quadrant/core';

/**
 * Call status as a filled pill (R5).
 *
 * All six states carry a distinct treatment — previously only three did, so
 * scanning the sheet for who still needs calling meant reading every row.
 * A status that shares a colour with another is a status she has to read, so
 * anything added here needs its own token pair, not a borrowed one.
 *
 * The pill *is* the select rather than an invisible select layered over a
 * span. The overlay version flickered: the native dropdown anchors to an
 * absolutely-positioned element inside a fixed-height cell with
 * `overflow: hidden`, and the popup fought that clipping every frame.
 *
 * The glyph rides in the option text, so the encoding never depends on colour
 * alone and survives dark mode and colour-blind viewing.
 */

/**
 * Roughly the order a lead moves through, so the dropdown reads as a path.
 * Re-exported from core rather than retyped: the two lists drifting apart
 * would silently reset a lead's status on load instead of failing to build.
 */
export const STATUSES: CallStatus[] = CALL_STATUSES;

export const STATUS_LABEL: Record<CallStatus, string> = {
  'new': 'New',
  'no-answer': 'No answer',
  // "Reached out" is a message sent with nobody on the other end yet;
  // "Follow up" is a conversation already had. The wording has to keep those
  // apart at a glance or she will use whichever one is nearer the cursor.
  'reached-out': 'Reached out',
  'follow-up': 'Follow up',
  'interested': 'Interested',
  'do-not-contact': 'Do not contact',
};

const STATUS_GLYPH: Record<CallStatus, string> = {
  'new': '●',
  'no-answer': '◌',
  'reached-out': '✉',
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
