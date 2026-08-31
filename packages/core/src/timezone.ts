/**
 * State -> IANA timezone. She is calling US offices from another continent,
 * so knowing the local hour at the other end is not a nicety.
 *
 * Split-timezone states resolve by longitude below; everything else is
 * single-zone and safe to map directly.
 */
const BY_STATE: Record<string, string> = {
  AL: 'America/Chicago', AR: 'America/Chicago', AZ: 'America/Phoenix',
  CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York',
  DC: 'America/New_York', DE: 'America/New_York', GA: 'America/New_York',
  IA: 'America/Chicago', IL: 'America/Chicago', LA: 'America/Chicago',
  MA: 'America/New_York', MD: 'America/New_York', ME: 'America/New_York',
  MN: 'America/Chicago', MO: 'America/Chicago', MS: 'America/Chicago',
  MT: 'America/Denver', NC: 'America/New_York', NH: 'America/New_York',
  NJ: 'America/New_York', NM: 'America/Denver', NY: 'America/New_York',
  OH: 'America/New_York', OK: 'America/Chicago', PA: 'America/New_York',
  RI: 'America/New_York', SC: 'America/New_York', UT: 'America/Denver',
  VA: 'America/New_York', VT: 'America/New_York', WA: 'America/Los_Angeles',
  WI: 'America/Chicago', WV: 'America/New_York', WY: 'America/Denver',
  AK: 'America/Anchorage', HI: 'Pacific/Honolulu',
};

/** States that straddle a boundary; resolved by longitude. */
const SPLIT: Record<string, { cut: number; west: string; east: string }> = {
  FL: { cut: -85.0, west: 'America/Chicago', east: 'America/New_York' },
  ID: { cut: -116.0, west: 'America/Los_Angeles', east: 'America/Denver' },
  IN: { cut: -87.3, west: 'America/Chicago', east: 'America/New_York' },
  KS: { cut: -101.5, west: 'America/Denver', east: 'America/Chicago' },
  KY: { cut: -85.9, west: 'America/Chicago', east: 'America/New_York' },
  MI: { cut: -90.4, west: 'America/Chicago', east: 'America/New_York' },
  ND: { cut: -100.8, west: 'America/Denver', east: 'America/Chicago' },
  NE: { cut: -101.4, west: 'America/Denver', east: 'America/Chicago' },
  NV: { cut: -114.1, west: 'America/Los_Angeles', east: 'America/Denver' },
  OR: { cut: -117.5, west: 'America/Los_Angeles', east: 'America/Denver' },
  SD: { cut: -100.3, west: 'America/Denver', east: 'America/Chicago' },
  TN: { cut: -85.3, west: 'America/Chicago', east: 'America/New_York' },
  TX: { cut: -105.0, west: 'America/Denver', east: 'America/Chicago' },
};

export function timezoneFor(state: string | null, lon: number | null): string | null {
  if (!state) return null;
  const st = state.toUpperCase();
  const split = SPLIT[st];
  if (split && lon != null) return lon < split.cut ? split.west : split.east;
  if (split) return split.east;
  return BY_STATE[st] ?? null;
}

/**
 * Intl formatters are expensive to construct - measurably so when a call sheet
 * holds thousands of rows and each one asks for the local time. There are only
 * a handful of distinct US timezones, so build one formatter per zone and keep it.
 */
const clockCache = new Map<string, Intl.DateTimeFormat>();
const partsCache = new Map<string, Intl.DateTimeFormat>();

function clockFor(tz: string): Intl.DateTimeFormat | null {
  let f = clockCache.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
      });
    } catch {
      return null;
    }
    clockCache.set(tz, f);
  }
  return f;
}

function partsFor(tz: string): Intl.DateTimeFormat | null {
  let f = partsCache.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: 'numeric', hour12: false, weekday: 'short',
      });
    } catch {
      return null;
    }
    partsCache.set(tz, f);
  }
  return f;
}

/** Local time at the practice right now, for the call sheet. */
export function localTimeAt(tz: string | null, at: Date = new Date()): string | null {
  if (!tz) return null;
  const f = clockFor(tz);
  return f ? f.format(at) : null;
}

/** Is it inside plausible US office hours (9-5, Mon-Fri) at that location? */
export function isOfficeHours(tz: string | null, at: Date = new Date()): boolean | null {
  if (!tz) return null;
  const f = partsFor(tz);
  if (!f) return null;
  const parts = f.formatToParts(at);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? -1);
  const day = parts.find((p) => p.type === 'weekday')?.value ?? '';
  if (day === 'Sat' || day === 'Sun') return false;
  return hour >= 9 && hour < 17;
}
