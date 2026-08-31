import type { Lead } from './types';

/**
 * One row per phone number.
 *
 * A practice can hold many NPIs - subparts, several providers, locations
 * sharing a front desk - and the registry lists each separately. Deduping by
 * NPI alone left one Phoenix number appearing 68 times, which as a call sheet
 * means dialling the same receptionist 68 times.
 *
 * The unit that matters for calling is the number she dials, so that is the
 * unit collapsed on. The others are not discarded: they become context, since
 * "you also cover these three practices" is useful on the call.
 */

export interface DedupeReport {
  before: number;
  after: number;
  collapsed: number;
}

function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  return d.length === 10 ? d : null;
}

export function dedupeByPhone(leads: Lead[]): { leads: Lead[]; report: DedupeReport } {
  const groups = new Map<string, Lead[]>();
  const noPhone: Lead[] = [];

  for (const lead of leads) {
    const key = normalizePhone(lead.phone);
    if (!key) {
      noPhone.push(lead);
      continue;
    }
    const bucket = groups.get(key);
    if (bucket) bucket.push(lead);
    else groups.set(key, [lead]);
  }

  const out: Lead[] = [];

  for (const bucket of groups.values()) {
    if (bucket.length === 1) {
      out.push(bucket[0]!);
      continue;
    }

    // Keep the strongest row as the one she calls.
    const sorted = [...bucket].sort((a, b) => b.score - a.score);
    const primary = sorted[0]!;
    const others = sorted.slice(1);

    // Fold in anything the primary happens to be missing.
    const merged: Lead = {
      ...primary,
      website: primary.website ?? others.find((o) => o.website)?.website ?? null,
      email: primary.email ?? others.find((o) => o.email)?.email ?? null,
      contactName: primary.contactName ?? others.find((o) => o.contactName)?.contactName ?? null,
      contactPhone: primary.contactPhone ?? others.find((o) => o.contactPhone)?.contactPhone ?? null,
      relatedCount: others.length,
      relatedNames: [...new Set(others.map((o) => o.practiceName))].slice(0, 12),
      relatedNpis: others.map((o) => o.sourceId).slice(0, 24),
    };

    out.push(merged);
  }

  out.push(...noPhone);
  out.sort((a, b) => b.score - a.score);

  return {
    leads: out,
    report: { before: leads.length, after: out.length, collapsed: leads.length - out.length },
  };
}
