/**
 * Fetches a real OpenStreetMap tile grid once and stitches it into a single
 * static image shipped with the site.
 *
 *   node tools/fetch-map.mjs
 *
 * Why bake it in rather than load a live map:
 *
 *   - A marketing hero must not depend on a third party being reachable. A
 *     live tile layer renders as a grey box when it rate-limits, and the
 *     CARTO basemap we tried earlier answered HTTP 200 while stamping every
 *     tile with "API KEY REQUIRED".
 *   - Embedding a live map means a request per visitor against OSM's tile
 *     servers, which their usage policy asks people not to do for exactly
 *     this kind of decorative use. One fetch at build-authoring time is
 *     within it.
 *   - No JavaScript, so the map is present in the HTML a crawler or
 *     link-preview scraper sees.
 *
 * Attribution is required and is rendered on the map itself by MapPreview.
 * Re-run this only when the pictured area should change.
 */
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_WEBP = join(HERE, '..', 'public', 'map-scottsdale.webp');
const OUT_PNG = join(HERE, '..', 'public', 'map-scottsdale-fallback.png');
// Rendered at ~1200px, so a wider asset is pure weight.
const DELIVER_WIDTH = 1400;

// Scottsdale, Arizona — the area every measured figure on the site comes from.
const LAT = 33.56;
const LON = -111.92;
const ZOOM = 12;
const COLS = 7;
const ROWS = 3;
const TILE = 256;

// OSM's tile policy asks for a real identifying User-Agent.
const UA = 'quadrant-site-build/0.1 (+https://github.com/itzmerai/Quadrant)';

function tileOrigin() {
  const n = 2 ** ZOOM;
  const xf = ((LON + 180) / 360) * n;
  const latRad = (LAT * Math.PI) / 180;
  const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return {
    x0: Math.floor(xf) - Math.floor(COLS / 2),
    y0: Math.floor(yf) - Math.floor(ROWS / 2),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTile(z, x, y) {
  const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const { x0, y0 } = tileOrigin();
const composites = [];

console.log(`Fetching ${COLS * ROWS} tiles at z${ZOOM} from (${x0}, ${y0})…`);

for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const x = x0 + col;
    const y = y0 + row;
    const buf = await fetchTile(ZOOM, x, y);
    composites.push({ input: buf, left: col * TILE, top: row * TILE });
    process.stdout.write('.');
    // Deliberately unhurried; this runs once, by hand.
    await sleep(120);
  }
}

process.stdout.write('\n');

await mkdir(dirname(OUT_WEBP), { recursive: true });

const stitched = await sharp({
  create: {
    width: COLS * TILE,
    height: ROWS * TILE,
    channels: 3,
    background: { r: 242, g: 239, b: 233 },
  },
})
  .composite(composites)
  .png()
  .toBuffer();

await sharp(stitched).resize(DELIVER_WIDTH).webp({ quality: 72 }).toFile(OUT_WEBP);
await sharp(stitched).resize(DELIVER_WIDTH).png({ compressionLevel: 9, palette: true, colors: 128 }).toFile(OUT_PNG);

const { statSync } = await import('node:fs');
for (const f of [OUT_WEBP, OUT_PNG]) {
  const kb = (statSync(f).size / 1024).toFixed(0);
  console.log('Wrote ' + f + ' - ' + kb + ' KB');
}
