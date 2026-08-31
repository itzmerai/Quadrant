import type { BBox } from '../types';
import { contains } from '../bbox';

export interface ZipRow {
  zip: string;
  lat: number;
  lon: number;
  state: string;
  city: string;
}

export type ZipIndex = ZipRow[];

/** Parse the bundled centroid file. ~42k rows, parses in well under 100ms. */
export function loadZipIndex(csvText: string): ZipIndex {
  const out: ZipIndex = [];
  const lines = csvText.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const p = line.split(',');
    if (p.length < 5) continue;
    const lat = Number(p[1]);
    const lon = Number(p[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ zip: p[0]!, lat, lon, state: p[3]!, city: p[4] ?? '' });
  }
  return out;
}

/**
 * NPPES searches by postal code, not by bounding box. This bridges the two:
 * every ZIP whose centroid falls inside the drawn box.
 *
 * Centroid-based, so a ZIP straddling the boundary is included only if its
 * center is inside. `pad` widens the box slightly to catch edge ZIPs whose
 * centroid sits just outside but whose area overlaps.
 */
export function zipsInBBox(index: ZipIndex, box: BBox, pad = 0.02): ZipRow[] {
  const padded: BBox = {
    south: box.south - pad,
    north: box.north + pad,
    west: box.west - pad,
    east: box.east + pad,
  };
  return index.filter((r) => contains(padded, r.lat, r.lon));
}

export function statesInBBox(index: ZipIndex, box: BBox): string[] {
  return [...new Set(zipsInBBox(index, box).map((r) => r.state))].sort();
}
