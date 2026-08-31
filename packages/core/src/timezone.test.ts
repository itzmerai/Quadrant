import { describe, expect, it } from 'vitest';
import { isOfficeHours, timezoneFor } from './timezone';
import { DEFAULT_CALLING_WINDOW, type CallingWindow } from './store/preferences';

/** Fixed instants in Phoenix local time (America/Phoenix, no DST). */
const TUE_10AM = new Date('2026-09-01T17:00:00Z'); // 10:00 Tue in Phoenix
const TUE_6PM = new Date('2026-09-02T01:00:00Z'); // 18:00 Tue in Phoenix
const SAT_10AM = new Date('2026-09-05T17:00:00Z'); // 10:00 Sat in Phoenix

const TZ = 'America/Phoenix';

describe('isOfficeHours', () => {
  it('reports open inside a 09:00-17:00 weekday window', () => {
    expect(isOfficeHours(TZ, DEFAULT_CALLING_WINDOW, TUE_10AM)).toBe(true);
  });

  it('reports closed after the window ends on a weekday', () => {
    expect(isOfficeHours(TZ, DEFAULT_CALLING_WINDOW, TUE_6PM)).toBe(false);
  });

  it('reports closed on a day the window excludes', () => {
    expect(isOfficeHours(TZ, DEFAULT_CALLING_WINDOW, SAT_10AM)).toBe(false);
  });

  it('reports open on Saturday when the window includes weekends', () => {
    const withWeekends: CallingWindow = { ...DEFAULT_CALLING_WINDOW, days: [0, 1, 2, 3, 4, 5, 6] };
    expect(isOfficeHours(TZ, withWeekends, SAT_10AM)).toBe(true);
  });

  it('honours a widened window that the default would have excluded', () => {
    const evening: CallingWindow = { ...DEFAULT_CALLING_WINDOW, startHour: 8, endHour: 20 };
    expect(isOfficeHours(TZ, evening, TUE_6PM)).toBe(true);
  });

  it('returns null for an unknown timezone rather than assuming open', () => {
    expect(isOfficeHours(null, DEFAULT_CALLING_WINDOW, TUE_10AM)).toBeNull();
  });

  it('treats a window whose end is not after its start as closed', () => {
    // Wrapping windows are rejected rather than silently inverted, so the
    // caller never gets a confident wrong answer. See the plan's Open Question.
    const wrapping: CallingWindow = { ...DEFAULT_CALLING_WINDOW, startHour: 20, endHour: 4 };
    expect(isOfficeHours(TZ, wrapping, TUE_10AM)).toBe(false);
  });
});

describe('timezoneFor', () => {
  it('resolves a single-zone state', () => {
    expect(timezoneFor('AZ', -111.9)).toBe('America/Phoenix');
  });

  it('resolves a split state by longitude', () => {
    expect(timezoneFor('FL', -87.2)).toBe('America/Chicago');
    expect(timezoneFor('FL', -80.2)).toBe('America/New_York');
  });

  it('returns null for an unknown state', () => {
    expect(timezoneFor('ZZ', -100)).toBeNull();
  });
});
