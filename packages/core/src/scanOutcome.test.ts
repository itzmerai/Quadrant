import { describe, expect, it } from 'vitest';
import {
  deriveEmailHuntResult,
  deriveScanResult,
  mergeEnrichment,
  territoryScanState,
} from './scanOutcome';
import type { MergeReport } from './store/types';
import type { Lead, Territory } from './types';

/**
 * What a finished run means for the box. Stopping has to keep the work and say
 * so (R2, R4, R14), and none of that is decidable from the pipeline alone - it
 * needs the merge report too. It lives here rather than in `App.tsx` because
 * the repo has no DOM test environment, and this is the part that has to be
 * right (KTD5).
 */

const NOW = '2026-03-04T10:00:00.000Z';
const EARLIER = '2026-02-01T09:00:00.000Z';

function report(over: Partial<MergeReport> = {}): MergeReport {
  return { added: 0, updated: 0, unchanged: 0, total: 0, ...over };
}

/** Only the two fields the derivation reads; the rest of a box is irrelevant. */
function box(over: Partial<Territory> = {}): Pick<Territory, 'lastScanAt' | 'lastPartialScanAt'> {
  return { lastScanAt: null, lastPartialScanAt: null, ...over };
}

function lead(id: string, over: Partial<Lead> = {}): Lead {
  return {
    id,
    territoryId: 'terr-1',
    practiceName: 'Practice ' + id,
    specialty: 'Dentist',
    specialtyGroup: 'dental',
    phone: '4809988073',
    contactName: null,
    contactTitle: null,
    contactPhone: null,
    address: null,
    city: null,
    state: null,
    zip: null,
    lat: null,
    lon: null,
    timezone: null,
    website: null,
    email: null,
    enumeratedAt: null,
    recordUpdatedAt: null,
    score: 50,
    scoreReasons: [],
    callStatus: 'new',
    source: 'nppes',
    sourceId: id,
    fetchedAt: EARLIER,
    ...over,
  };
}

describe('deriveScanResult', () => {
  it('marks a stopped first scan as partial and leaves the completed stamp alone', () => {
    const derived = deriveScanResult({
      cancelled: true,
      report: report({ added: 412, total: 412 }),
      territory: box(),
      at: NOW,
    });

    expect(derived.scanState.lastPartialScanAt).toBe(NOW);
    expect(derived.scanState.lastScanAt).toBeNull();
    expect(derived.phase).toBe('cancelled');
    // R14 - a stop names what was kept, so she can see the work survived.
    expect(derived.message).toContain('Stopped');
    expect(derived.message).toContain('412');
  });

  it('marks a completed scan as scanned and clears any earlier partial stamp', () => {
    const derived = deriveScanResult({
      cancelled: false,
      report: report({ added: 3, updated: 1, total: 404 }),
      territory: box({ lastPartialScanAt: EARLIER }),
      at: NOW,
    });

    expect(derived.scanState.lastScanAt).toBe(NOW);
    // Finishing the box is what retires the partial mark; nothing else does.
    expect(derived.scanState.lastPartialScanAt).toBeNull();
    expect(derived.phase).toBe('done');
    expect(derived.message).toContain('404');
  });

  it('does not present a stopped rescan of an already-scanned box as freshly complete', () => {
    const derived = deriveScanResult({
      cancelled: true,
      report: report({ added: 5, total: 409 }),
      territory: box({ lastScanAt: EARLIER }),
      at: NOW,
    });

    // The old stamp is the truth about the last completed run - it is not
    // advanced, and it is not wiped either.
    expect(derived.scanState.lastScanAt).toBe(EARLIER);
    expect(derived.scanState.lastPartialScanAt).toBe(NOW);
    // R4 - without the partial field this box would be indistinguishable from
    // one that finished, which is the whole reason the field exists (KTD4).
    expect(territoryScanState(derived.scanState)).toBe('partial');
  });

  it('reports a stop that found nothing as a stop, not an error and not a fresh box', () => {
    const derived = deriveScanResult({
      cancelled: true,
      report: report(),
      territory: box(),
      at: NOW,
    });

    expect(derived.phase).toBe('cancelled');
    expect(derived.phase).not.toBe('error');
    expect(derived.leadCount).toBe(0);
    // She stopped it; the box was searched, just not to the end.
    expect(territoryScanState(derived.scanState)).toBe('partial');
  });

  it('takes the lead count from the merge report whether or not it was stopped', () => {
    const merged = report({ added: 12, updated: 4, unchanged: 380, total: 396 });

    expect(deriveScanResult({ cancelled: true, report: merged, territory: box(), at: NOW }).leadCount)
      .toBe(396);
    expect(deriveScanResult({ cancelled: false, report: merged, territory: box(), at: NOW }).leadCount)
      .toBe(396);
  });
});

describe('territoryScanState', () => {
  it('calls a box with no stamps never scanned', () => {
    expect(territoryScanState(box())).toBe('never');
  });

  it('calls a box with only a partial stamp partially scanned', () => {
    expect(territoryScanState(box({ lastPartialScanAt: NOW }))).toBe('partial');
  });

  it('calls a box with only a completed stamp fully scanned', () => {
    expect(territoryScanState(box({ lastScanAt: NOW }))).toBe('complete');
  });

  it('lets the partial stamp win, since finishing a scan is what clears it', () => {
    expect(territoryScanState(box({ lastScanAt: EARLIER, lastPartialScanAt: NOW }))).toBe('partial');
  });

  it('treats a box stored before the field existed as never scanned', () => {
    // Territory documents written by earlier builds have no partial key at all.
    expect(territoryScanState({ lastScanAt: null })).toBe('never');
  });
});

describe('deriveEmailHuntResult', () => {
  it('reports a stopped hunt as a stop, naming the emails it kept', () => {
    const derived = deriveEmailHuntResult({
      cancelled: true,
      gained: 7,
      resolved: 20,
      rejected: 0,
      leadCount: 400,
    });

    expect(derived.phase).toBe('cancelled');
    // R3/R14 - "Found 7 more emails" with a completed phase would claim the
    // hunt finished the box when she stopped it.
    expect(derived.message).toContain('Stopped');
    expect(derived.message).toContain('7');
  });

  it('reports a finished hunt with what it found', () => {
    const derived = deriveEmailHuntResult({
      cancelled: false,
      gained: 31,
      resolved: 88,
      rejected: 0,
      leadCount: 400,
    });

    expect(derived.phase).toBe('done');
    expect(derived.message).toContain('31');
    expect(derived.message).toContain('88');
    expect(derived.message).not.toContain('rejected');
  });

  it('mentions rejected domains only when there were some', () => {
    expect(
      deriveEmailHuntResult({ cancelled: false, gained: 1, resolved: 2, rejected: 3, leadCount: 9 })
        .message,
    ).toContain('rejected');
  });
});

describe('mergeEnrichment', () => {
  it('keeps a status and note written while the hunt was running', () => {
    // R15 - the hunt started from a snapshot taken before she touched these.
    const stored = [
      lead('a', { callStatus: 'interested', callNote: 'asked for a callback Tuesday' }),
    ];
    const enriched = [lead('a', { email: 'front@ironwood.test', website: 'https://ironwood.test' })];

    const merged = mergeEnrichment(stored, enriched);

    expect(merged[0]!.callStatus).toBe('interested');
    expect(merged[0]!.callNote).toBe('asked for a callback Tuesday');
    expect(merged[0]!.email).toBe('front@ironwood.test');
    expect(merged[0]!.website).toBe('https://ironwood.test');
  });

  it('does not resurrect a lead that is no longer stored', () => {
    const merged = mergeEnrichment([lead('a')], [lead('a'), lead('gone')]);
    expect(merged.map((l) => l.id)).toEqual(['a']);
  });

  it('leaves a stored lead the hunt never reached untouched', () => {
    const stored = [lead('a', { email: 'known@ironwood.test' }), lead('b')];
    const merged = mergeEnrichment(stored, [lead('b', { email: 'new@saguaro.test' })]);

    expect(merged.map((l) => l.id)).toEqual(['a', 'b']);
    expect(merged[0]!.email).toBe('known@ironwood.test');
    expect(merged[1]!.email).toBe('new@saguaro.test');
  });

  it('never blanks an address the hunt failed to reconfirm', () => {
    const stored = [lead('a', { email: 'known@ironwood.test', website: 'https://ironwood.test' })];
    const merged = mergeEnrichment(stored, [lead('a', { email: null, website: null })]);

    expect(merged[0]!.email).toBe('known@ironwood.test');
    expect(merged[0]!.website).toBe('https://ironwood.test');
  });
});
