/**
 * Headless call-sheet generator. Proves the engine before any UI exists.
 *
 *   npx tsx packages/core/src/cli.ts \
 *     --bbox 33.45,-112.15,33.62,-111.85 \
 *     --name "Scottsdale Dentists" \
 *     --specialties dental,chiro \
 *     --out leads.csv
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHttp, CancelToken } from './http';
import { loadZipIndex, zipsInBBox } from './zip/resolver';
import { runScan } from './pipeline';
import { leadsToCsv } from './export/csv';
import { areaKm2, formatBBox, isValid } from './bbox';
import { presetKeys, SPECIALTY_GROUPS } from './taxonomy';
import { scoreBand } from './score';
import type { BBox } from './types';

const HERE = dirname(fileURLToPath(import.meta.url));
const ZIP_CSV = resolve(HERE, '../data/zip-centroids.csv');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function parseBBox(s: string): BBox {
  const p = s.split(',').map((n) => Number(n.trim()));
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) {
    throw new Error('--bbox needs 4 numbers: south,west,north,east');
  }
  return { south: p[0]!, west: p[1]!, north: p[2]!, east: p[3]! };
}

async function main() {
  const bboxArg = arg('bbox');
  if (!bboxArg) {
    console.error('Usage: --bbox south,west,north,east [--name X] [--specialties a,b] [--out f.csv]');
    console.error('\nSpecialty keys:');
    for (const g of SPECIALTY_GROUPS) {
      console.error('  ' + g.key.padEnd(20) + (g.preset ? '(preset) ' : '         ') + g.label);
    }
    process.exit(1);
  }

  const bbox = parseBBox(bboxArg);
  if (!isValid(bbox)) throw new Error('Invalid bbox: ' + JSON.stringify(bbox));

  const name = arg('name') ?? 'Untitled territory';
  const specialties = arg('specialties')?.split(',').map((s) => s.trim()).filter(Boolean) ?? presetKeys();
  const out = arg('out') ?? 'leads.csv';

  console.log('Territory : ' + name);
  console.log('Box       : ' + formatBBox(bbox));
  console.log('Area      : ' + Math.round(areaKm2(bbox)).toLocaleString() + ' km2');
  console.log('Specialty : ' + specialties.join(', '));

  const zipIndex = loadZipIndex(readFileSync(ZIP_CSV, 'utf8'));
  const zips = zipsInBBox(zipIndex, bbox);
  console.log('ZIPs      : ' + zips.length + ' inside the box');
  if (!zips.length) {
    console.error('\nNo US ZIP codes in this box. NPPES covers the United States only.');
    process.exit(1);
  }
  console.log('');

  const started = Date.now();
  const outcome = await runScan({
    territory: {
      id: 'cli', name, bbox, country: 'US', specialties,
      createdAt: new Date().toISOString(), lastScanAt: null, leadCount: 0,
    },
    http: createHttp({ retries: 2, timeoutMs: 25_000 }),
    zipIndex,
    cancel: new CancelToken(),
    enrichWebsites: arg('no-enrich') === undefined,
    crawlEmails: process.argv.includes('--crawl'),
    onProgress: (p) => {
      process.stdout.write('\r  ' + p.message.padEnd(60).slice(0, 60) + ' leads: ' + p.leadsFound + '   ');
    },
  });
  const result = { leads: outcome.leads, warnings: outcome.warnings, queriesRun: outcome.stats.queriesRun };
  process.stdout.write('\n\n');

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const leads = result.leads;

  const withPhone = leads.filter((l) => l.phone).length;
  const withContact = leads.filter((l) => l.contactName).length;
  const withDirect = leads.filter((l) => l.contactPhone && l.contactPhone !== l.phone).length;
  const pct = (n: number) => (leads.length ? ((n / leads.length) * 100).toFixed(1) + '%' : '-');

  console.log('=== RESULT ===');
  console.log('leads          : ' + leads.length);
  console.log('queries        : ' + result.queriesRun + '  in ' + elapsed + 's');
  console.log('with phone     : ' + withPhone + '  ' + pct(withPhone));
  console.log('named contact  : ' + withContact + '  ' + pct(withContact));
  console.log('direct line    : ' + withDirect + '  ' + pct(withDirect));

  const withSite = leads.filter((l) => l.website).length;
  const withEmail = leads.filter((l) => l.email).length;
  console.log('website        : ' + withSite + '  ' + pct(withSite) +
    '   (OSM had ' + outcome.stats.osmPlaces + ' places, matched ' + outcome.stats.osmMatched + ')');
  console.log('email          : ' + withEmail + '  ' + pct(withEmail) +
    '   (crawled ' + outcome.stats.crawlAttempted + ', found ' + outcome.stats.emailsFound + ')');

  const bands = { hot: 0, warm: 0, cool: 0 };
  for (const l of leads) bands[scoreBand(l.score)]++;
  console.log('bands          : hot ' + bands.hot + ' | warm ' + bands.warm + ' | cool ' + bands.cool);

  const byGroup = new Map<string, number>();
  for (const l of leads) byGroup.set(l.specialtyGroup, (byGroup.get(l.specialtyGroup) ?? 0) + 1);
  console.log('by specialty   : ' + [...byGroup.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => k + '=' + v)
    .join(', '));

  for (const w of result.warnings) console.log('\nWARNING: ' + w);

  console.log('\n=== TOP 5 BY CALL ORDER ===');
  for (const l of leads.slice(0, 5)) {
    console.log('\n[' + l.score + '] ' + l.practiceName + '  (' + l.specialty + ')');
    console.log('      phone   ' + (l.phone ?? '-'));
    console.log('      ask for ' + (l.contactName ?? '-') + (l.contactTitle ? ', ' + l.contactTitle : ''));
    console.log('      direct  ' + (l.contactPhone ?? '-'));
    console.log('      where   ' + [l.city, l.state, l.zip].filter(Boolean).join(', '));
    console.log('      why     ' + l.scoreReasons.join('; '));
  }

  writeFileSync(out, leadsToCsv(leads), 'utf8');
  console.log('\nWrote ' + leads.length + ' leads -> ' + out);
}

main().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
