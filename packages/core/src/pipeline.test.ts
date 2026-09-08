import { describe, expect, it } from 'vitest';
import { runScan } from './pipeline';
import { CancelToken, createHttp, type FetchFn } from './http';
import { acceptsMail } from './enrich/mx';
import type { ZipIndex } from './zip/resolver';
import type { Territory } from './types';

/**
 * A stop is a returned outcome, not a thrown error (KTD2). These tests hold
 * `runScan` to that at every stage it can be stopped in, and hold the warning
 * list to reporting only what genuinely went wrong (R14).
 *
 * Everything here is in-memory: a hand-built `ZipIndex` instead of the bundled
 * 42k-row CSV, and a routed `fetchFn` instead of the network.
 */

const BOX = { south: 33.0, north: 33.5, west: -112.5, east: -112.0 };

const ZIPS = ['85001', '85002', '85003'];

function zipIndex(zips: string[] = ZIPS): ZipIndex {
  return zips.map((zip, i) => ({
    zip,
    lat: 33.1 + i * 0.01,
    lon: -112.4 + i * 0.01,
    state: 'AZ',
    city: 'Phoenix',
  }));
}

function territory(): Territory {
  return {
    id: 'terr-1',
    name: 'Phoenix',
    bbox: BOX,
    country: 'US',
    specialties: ['dental'],
    createdAt: '2026-01-01T00:00:00.000Z',
    lastScanAt: null,
    leadCount: 0,
  };
}

/** Only the members the http client and the providers actually read. */
const jsonRes = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const textRes = (body: string) =>
  ({ ok: true, status: 200, text: async () => body, json: async () => ({}) }) as unknown as Response;

/** Never settles on its own; the caller's signal is the only way out. */
const hang = (signal?: AbortSignal | null) =>
  new Promise<Response>((_resolve, reject) => {
    const fail = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    if (signal?.aborted) return fail();
    signal?.addEventListener('abort', fail, { once: true });
  });

/** A macrotask, so every pending microtask chain finishes before we continue. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

interface RecordOpts {
  phone?: string;
  official?: string;
}

function nppesRecord(npi: string, name: string, zip: string, opts: RecordOpts = {}) {
  return {
    number: npi,
    enumeration_type: 'NPI-2',
    basic: {
      organization_name: name,
      status: 'A',
      enumeration_date: '2010-04-02',
      last_updated: '2011-05-01',
      ...(opts.official
        ? { authorized_official_first_name: opts.official, authorized_official_last_name: 'Reyes' }
        : {}),
    },
    addresses: [
      {
        address_purpose: 'LOCATION',
        address_1: '1 Main St',
        city: 'Phoenix',
        state: 'AZ',
        postal_code: zip,
        telephone_number: opts.phone ?? '4809988073',
        country_code: 'US',
      },
    ],
    taxonomies: [{ code: '1223G0001X', desc: 'Dentist', primary: true }],
  };
}

const page = (records: unknown[]) => jsonRes({ result_count: records.length, results: records });

const isNppes = (url: string) => url.includes('npiregistry');
const isOverpass = (url: string) => url.includes('overpass');

/** retries:0 keeps a deliberate failure from sitting through two backoffs. */
const testHttp = (fetchFn: FetchFn) => createHttp({ fetchFn, retries: 0, timeoutMs: 5_000 });

describe('runScan cancellation', () => {
  it('keeps the leads found before a stop during the registry query', async () => {
    const token = new CancelToken();
    let calls = 0;
    const fetchFn: FetchFn = async (url, init) => {
      if (!isNppes(url)) throw new Error('unexpected ' + url);
      calls++;
      if (calls === 1) return page([nppesRecord('1', 'Ironwood Dental', '85001')]);
      // Let ZIP 1 land, then stop mid-flight on the others.
      await tick();
      token.cancel();
      return hang(init?.signal);
    };

    const outcome = await runScan({
      territory: territory(),
      http: testHttp(fetchFn),
      zipIndex: zipIndex(),
      cancel: token,
      enrichWebsites: false,
    });

    expect(outcome.cancelled).toBe(true);
    expect(outcome.leads.map((l) => l.practiceName)).toEqual(['Ironwood Dental']);
  });

  it('reports no warnings at all when the stop is the only thing that went wrong', async () => {
    const token = new CancelToken();
    let calls = 0;
    const fetchFn: FetchFn = async (url, init) => {
      if (!isNppes(url)) throw new Error('unexpected ' + url);
      calls++;
      if (calls === 1) return page([nppesRecord('1', 'Ironwood Dental', '85001')]);
      await tick();
      token.cancel();
      return hang(init?.signal);
    };

    const outcome = await runScan({
      territory: territory(),
      http: testHttp(fetchFn),
      zipIndex: zipIndex(),
      cancel: token,
      // Enrichment on, so the "OpenStreetMap returned nothing" warning is in play.
      enrichWebsites: true,
    });

    expect(outcome.cancelled).toBe(true);
    expect(outcome.warnings).toEqual([]);
  });

  it('keeps the registry leads when the stop lands during enrichment', async () => {
    const token = new CancelToken();
    const fetchFn: FetchFn = async (url, init) => {
      if (isNppes(url)) {
        const zip = new URL(url).searchParams.get('postal_code') ?? '';
        return page([nppesRecord('npi-' + zip, 'Practice ' + zip, zip, { phone: '48099880' + zip.slice(-2) })]);
      }
      if (isOverpass(url)) {
        token.cancel();
        return hang(init?.signal);
      }
      throw new Error('unexpected ' + url);
    };

    const outcome = await runScan({
      territory: territory(),
      http: testHttp(fetchFn),
      zipIndex: zipIndex(),
      cancel: token,
      enrichWebsites: true,
    });

    expect(outcome.cancelled).toBe(true);
    expect(outcome.leads).toHaveLength(3);
    expect(outcome.warnings).toEqual([]);
  });

  it('yields an empty lead list rather than an error when stopped before any ZIP returns', async () => {
    const token = new CancelToken();
    token.cancel();
    const fetchFn: FetchFn = async () => {
      throw new Error('no request should have been issued');
    };

    const outcome = await runScan({
      territory: territory(),
      http: testHttp(fetchFn),
      zipIndex: zipIndex(),
      cancel: token,
    });

    expect(outcome.cancelled).toBe(true);
    expect(outcome.leads).toEqual([]);
    expect(outcome.warnings).toEqual([]);
  });

  it('still dedupes by phone and orders by score in what it kept', async () => {
    const token = new CancelToken();
    let calls = 0;
    const fetchFn: FetchFn = async (url, init) => {
      if (!isNppes(url)) throw new Error('unexpected ' + url);
      calls++;
      if (calls === 1) {
        return page([
          // Two registrations behind one front desk, plus a stronger lead
          // returned last so ordering has to do real work.
          nppesRecord('1', 'Ironwood Dental', '85001', { phone: '4809988073' }),
          nppesRecord('2', 'Ironwood Dental Subpart', '85001', { phone: '(480) 998-8073' }),
          nppesRecord('3', 'Saguaro Dental', '85001', { phone: '4805551212', official: 'Ana' }),
        ]);
      }
      await tick();
      token.cancel();
      return hang(init?.signal);
    };

    const outcome = await runScan({
      territory: territory(),
      http: testHttp(fetchFn),
      zipIndex: zipIndex(),
      cancel: token,
      enrichWebsites: false,
    });

    expect(outcome.cancelled).toBe(true);
    expect(outcome.stats.duplicatesMerged).toBe(1);
    expect(outcome.leads).toHaveLength(2);
    expect(outcome.leads[0]!.practiceName).toBe('Saguaro Dental');
    const scores = outcome.leads.map((l) => l.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
});

describe('runScan without a stop', () => {
  it('reports cancelled false on a clean run', async () => {
    const fetchFn: FetchFn = async (url) => {
      if (isNppes(url)) {
        const zip = new URL(url).searchParams.get('postal_code') ?? '';
        return page([nppesRecord('npi-' + zip, 'Practice ' + zip, zip, { phone: '48099880' + zip.slice(-2) })]);
      }
      if (isOverpass(url)) return jsonRes({ elements: [] });
      throw new Error('unexpected ' + url);
    };

    const outcome = await runScan({
      territory: territory(),
      http: testHttp(fetchFn),
      zipIndex: zipIndex(),
      enrichWebsites: false,
    });

    expect(outcome.cancelled).toBe(false);
    expect(outcome.leads).toHaveLength(3);
  });

  it('tolerates an Overpass failure that is not a cancellation', async () => {
    const fetchFn: FetchFn = async (url) => {
      if (isNppes(url)) {
        const zip = new URL(url).searchParams.get('postal_code') ?? '';
        return page([nppesRecord('npi-' + zip, 'Practice ' + zip, zip, { phone: '48099880' + zip.slice(-2) })]);
      }
      if (isOverpass(url)) throw new Error('Overpass said no');
      throw new Error('unexpected ' + url);
    };

    const outcome = await runScan({
      territory: territory(),
      http: testHttp(fetchFn),
      zipIndex: zipIndex(),
      enrichWebsites: true,
    });

    expect(outcome.cancelled).toBe(false);
    expect(outcome.leads).toHaveLength(3);
    expect(outcome.stats.osmPlaces).toBe(0);
    expect(outcome.warnings.some((w) => w.includes('OpenStreetMap lookup returned nothing'))).toBe(
      true,
    );
  });

  it('still warns about a genuine per-ZIP failure and lets the other ZIPs finish', async () => {
    const fetchFn: FetchFn = async (url) => {
      if (!isNppes(url)) throw new Error('unexpected ' + url);
      const zip = new URL(url).searchParams.get('postal_code') ?? '';
      if (zip === '85002') throw new Error('boom');
      return page([nppesRecord('npi-' + zip, 'Practice ' + zip, zip, { phone: '48099880' + zip.slice(-2) })]);
    };

    const outcome = await runScan({
      territory: territory(),
      http: testHttp(fetchFn),
      zipIndex: zipIndex(),
      enrichWebsites: false,
    });

    expect(outcome.cancelled).toBe(false);
    expect(outcome.leads).toHaveLength(2);
    expect(outcome.warnings.some((w) => w.startsWith('ZIP 85002 failed:'))).toBe(true);
  });
});

describe('acceptsMail', () => {
  it('does not cache a negative result when the lookup was cancelled', async () => {
    // The cache is module-lived, so a poisoned entry would outlast the scan.
    const domain = 'mx-cancel-probe.test';
    const token = new CancelToken();
    const cancelling = testHttp(async (_url, init) => {
      token.cancel();
      return hang(init?.signal);
    });

    await expect(acceptsMail(domain, cancelling, token)).rejects.toBeTruthy();

    const working = testHttp(async () =>
      jsonRes({ Answer: [{ type: 15, data: '10 mx.example.test.' }] }),
    );
    expect(await acceptsMail(domain, working)).toBe(true);
  });

  it('does cache an ordinary negative result', async () => {
    const domain = 'mx-negative-probe.test';
    let calls = 0;
    const failing = testHttp(async () => {
      calls++;
      throw new Error('dns down');
    });

    expect(await acceptsMail(domain, failing)).toBe(false);
    expect(await acceptsMail(domain, failing)).toBe(false);
    expect(calls).toBe(1);
  });
});
