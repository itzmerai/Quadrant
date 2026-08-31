import type { Lead, Territory } from '../types';
import { localTimeAt } from '../timezone';
import { scoreBand } from '../score';

/** RFC 4180 quoting. Excel is unforgiving about the details. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export interface CsvColumn {
  header: string;
  get: (lead: Lead) => unknown;
}

/**
 * Column order is the order she reads them while dialling: who, how to reach
 * them, when it is safe to call, then the context for the pitch.
 */
export const CALL_SHEET_COLUMNS: CsvColumn[] = [
  { header: 'Score', get: (l) => l.score },
  { header: 'Band', get: (l) => scoreBand(l.score) },
  { header: 'Practice', get: (l) => l.practiceName },
  { header: 'Phone', get: (l) => l.phone },
  { header: 'Ask For', get: (l) => l.contactName },
  { header: 'Their Title', get: (l) => l.contactTitle },
  { header: 'Direct Line', get: (l) => l.contactPhone },
  { header: 'Local Time Now', get: (l) => localTimeAt(l.timezone) },
  { header: 'Timezone', get: (l) => l.timezone },
  { header: 'Specialty', get: (l) => l.specialty },
  { header: 'Address', get: (l) => l.address },
  { header: 'City', get: (l) => l.city },
  { header: 'State', get: (l) => l.state },
  { header: 'ZIP', get: (l) => l.zip },
  { header: 'Website', get: (l) => l.website },
  { header: 'Email', get: (l) => l.email },
  { header: 'Practice Since', get: (l) => l.enumeratedAt },
  { header: 'Record Updated', get: (l) => l.recordUpdatedAt },
  { header: 'Why This Lead', get: (l) => l.scoreReasons.join('; ') },
  { header: 'Call Status', get: (l) => l.callStatus },
  { header: 'Notes', get: (l) => l.callNote ?? '' },
  { header: 'NPI', get: (l) => l.sourceId },
  { header: 'Source', get: (l) => l.source },
];

export function leadsToCsv(leads: Lead[], columns: CsvColumn[] = CALL_SHEET_COLUMNS): string {
  const head = columns.map((c) => cell(c.header)).join(',');
  const rows = leads.map((l) => columns.map((c) => cell(c.get(l))).join(','));
  // BOM so Excel opens UTF-8 correctly on Windows.
  return '﻿' + [head, ...rows].join('\r\n') + '\r\n';
}

export function suggestFilename(territory: Territory): string {
  const slug = territory.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'territory';
  const date = new Date().toISOString().slice(0, 10);
  return slug + '-' + date + '.csv';
}
