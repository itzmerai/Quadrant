import { describe, expect, it } from 'vitest';
import { CALL_STATUSES, normalizeCallStatus } from './types';

/**
 * Driven by the exported list, not a copy of it.
 *
 * This used to retype the six values with a comment claiming that adding a
 * status without teaching `normalizeCallStatus` about it would fail here. It
 * would not have: a `CallStatus[]` literal need not be exhaustive, so a
 * seventh status left the copy stale and the suite green. The real guard is
 * the total `Record<CallStatus, true>` behind `CALL_STATUSES`; reading from it
 * is what makes this test enforce anything.
 */
const CURRENT = CALL_STATUSES;

describe('normalizeCallStatus', () => {
  it('returns "reached-out" unchanged', () => {
    // The status added for R6. A stored lead marked emailed must still read
    // as emailed after a reload, not fall through to the `new` default.
    expect(normalizeCallStatus('reached-out')).toBe('reached-out');
  });

  it.each(CURRENT)('round-trips the current value %s', (status) => {
    expect(normalizeCallStatus(status)).toBe(status);
  });

  it('maps every legacy value to the status that replaced it', () => {
    // Asserted as a block because the legacy table is the only thing standing
    // between leads written by earlier builds and a silent reset to `new`.
    // Adding a status must not disturb any of these mappings.
    expect(normalizeCallStatus('queued')).toBe('new');
    expect(normalizeCallStatus('called')).toBe('no-answer');
    expect(normalizeCallStatus('voicemail')).toBe('follow-up');
    expect(normalizeCallStatus('callback')).toBe('follow-up');
    expect(normalizeCallStatus('not-interested')).toBe('do-not-contact');
  });

  it('does not divert the legacy contact-made values to "reached-out"', () => {
    // `voicemail` and `callback` mean a conversation or a voicemail happened,
    // which is "Follow up". "Reached out" is the case where none did (R6), so
    // the new status must not capture them just because it sounds adjacent.
    expect(normalizeCallStatus('voicemail')).not.toBe('reached-out');
    expect(normalizeCallStatus('callback')).not.toBe('reached-out');
  });

  it('falls back to "new" for a value it has never seen', () => {
    expect(normalizeCallStatus('emailed')).toBe('new');
  });

  it('falls back to "new" for undefined and null', () => {
    // Leads written before `callStatus` existed carry neither, and the loader
    // hands the raw field straight through rather than pre-checking it.
    expect(normalizeCallStatus(undefined)).toBe('new');
    expect(normalizeCallStatus(null)).toBe('new');
  });
});

/*
 * The order is presentation, not incidental: it is what the status dropdown and
 * the filter render, roughly the path a lead walks. Pinned here because nothing
 * else would notice a reordering, and "Reached out" sitting after "Follow up"
 * would quietly invert the two states the split exists to keep apart.
 */
describe('CALL_STATUSES', () => {
  it('keeps the order a lead moves through', () => {
    expect(CALL_STATUSES).toEqual([
      'new',
      'no-answer',
      'reached-out',
      'follow-up',
      'interested',
      'do-not-contact',
    ]);
  });
});
