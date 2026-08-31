import type { BBox } from './types';

/** Build a normalized box from any two corners the user dragged between. */
export function bboxFromCorners(a: [number, number], b: [number, number]): BBox {
  return {
    south: Math.min(a[0], b[0]),
    north: Math.max(a[0], b[0]),
    west: Math.min(a[1], b[1]),
    east: Math.max(a[1], b[1]),
  };
}

export function contains(box: BBox, lat: number, lon: number): boolean {
  return lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east;
}

export function isValid(box: BBox): boolean {
  return (
    box.south >= -90 && box.north <= 90 && box.west >= -180 && box.east <= 180 &&
    box.north > box.south && box.east > box.west
  );
}

/** Rough area in km². Good enough to warn about oversized boxes. */
export function areaKm2(box: BBox): number {
  const midLat = ((box.north + box.south) / 2) * (Math.PI / 180);
  const h = (box.north - box.south) * 110.574;
  const w = (box.east - box.west) * 111.32 * Math.cos(midLat);
  return Math.abs(h * w);
}

/** Overpass wants south,west,north,east. */
export function toOverpass(box: BBox): string {
  return `${box.south},${box.west},${box.north},${box.east}`;
}

export function formatBBox(box: BBox, digits = 4): string {
  const f = (n: number) => n.toFixed(digits);
  return `SW ${f(box.south)}, ${f(box.west)}  ·  NE ${f(box.north)}, ${f(box.east)}`;
}

/** Split a box into a grid of sub-boxes, for sources that cap results per query. */
export function tile(box: BBox, maxSpanDeg: number): BBox[] {
  const rows = Math.max(1, Math.ceil((box.north - box.south) / maxSpanDeg));
  const cols = Math.max(1, Math.ceil((box.east - box.west) / maxSpanDeg));
  const dLat = (box.north - box.south) / rows;
  const dLon = (box.east - box.west) / cols;
  const out: BBox[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        south: box.south + r * dLat,
        north: box.south + (r + 1) * dLat,
        west: box.west + c * dLon,
        east: box.west + (c + 1) * dLon,
      });
    }
  }
  return out;
}
