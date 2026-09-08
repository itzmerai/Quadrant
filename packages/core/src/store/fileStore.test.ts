import { describe, expect, it } from 'vitest';
import { createFileStore } from './fileStore';
import type { FsAdapter } from './types';
import type { Lead } from '../types';

/** In-memory adapter so these tests exercise the store, not the filesystem. */
function memoryFs(seed: Record<string, string> = {}): FsAdapter {
  const files = new Map(Object.entries(seed));
  return {
    async readText(path) {
      return files.get(path) ?? null;
    },
    async writeText(path, contents) {
      files.set(path, contents);
    },
    async mkdir() {},
    async listDirs() {
      return [];
    },
    async remove(path) {
      files.delete(path);
    },
  };
}

const LEADS = 'territories/scottsdale/leads.json';

function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: 'npi-1',
    territoryId: 'scottsdale',
    practiceName: 'Ironwood Dental',
    specialty: 'Dentist',
    specialtyGroup: 'dental',
    phone: '480-555-0100',
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
    score: 60,
    scoreReasons: [],
    callStatus: 'new',
    source: 'nppes',
    sourceId: '1',
    fetchedAt: '2026-01-05T09:00:00.000Z',
    ...over,
  };
}

/** A lead exactly as an earlier build wrote it: one string, no list. */
const legacyOnDisk = JSON.stringify([
  lead({
    callStatus: 'interested',
    callNote: 'asked for a callback Tuesday',
    lastCalledAt: '2026-01-20T17:30:00.000Z',
  }),
]);

describe('getLeads', () => {
  it('migrates a legacy note into the dated list', async () => {
    const store = createFileStore(memoryFs({ [LEADS]: legacyOnDisk }));
    const [got] = await store.getLeads('scottsdale');

    expect(got!.callNotes).toHaveLength(1);
    expect(got!.callNotes![0]!.text).toBe('asked for a callback Tuesday');
    expect(got!.callNotes![0]!.createdAt).toBe('2026-01-20T17:30:00.000Z');
  });

  it('honours an empty list over a legacy string still on the record', async () => {
    const fs = memoryFs({
      [LEADS]: JSON.stringify([lead({ callNote: 'stale', callNotes: [] })]),
    });
    const [got] = await createFileStore(fs).getLeads('scottsdale');
    expect(got!.callNotes).toEqual([]);
  });
});

describe('mergeLeads', () => {
  it('preserves the migrated note when the stored lead is still in the legacy shape', async () => {
    // KTD6 - mergeLeads reads the file raw. Without normalising here, a rescan
    // carries callNotes as undefined and the note is gone with no error.
    const fs = memoryFs({ [LEADS]: legacyOnDisk });
    const store = createFileStore(fs);

    await store.mergeLeads('scottsdale', [lead({ phone: '480-555-0199' })]);
    const [got] = await store.getLeads('scottsdale');

    expect(got!.callNotes).toHaveLength(1);
    expect(got!.callNotes![0]!.text).toBe('asked for a callback Tuesday');
    expect(got!.callStatus).toBe('interested');
    // Registry data still refreshes.
    expect(got!.phone).toBe('480-555-0199');
  });

  it('preserves an existing note list across a rescan', async () => {
    const notes = [
      { id: 'n1', text: 'left a voicemail', createdAt: '2026-01-10T10:00:00.000Z' },
      { id: 'n2', text: 'spoke to Dana', createdAt: '2026-01-14T10:00:00.000Z' },
    ];
    const fs = memoryFs({
      [LEADS]: JSON.stringify([lead({ callStatus: 'follow-up', callNotes: notes })]),
    });
    const store = createFileStore(fs);

    await store.mergeLeads('scottsdale', [lead({ practiceName: 'Ironwood Dental Group' })]);
    const [got] = await store.getLeads('scottsdale');

    expect(got!.callNotes).toEqual(notes);
    expect(got!.callStatus).toBe('follow-up');
    expect(got!.practiceName).toBe('Ironwood Dental Group');
  });

  it('does not resurrect a deleted migrated note on rescan', async () => {
    const fs = memoryFs({
      [LEADS]: JSON.stringify([lead({ callNote: 'stale', callNotes: [] })]),
    });
    const store = createFileStore(fs);

    await store.mergeLeads('scottsdale', [lead()]);
    expect((await store.getLeads('scottsdale'))[0]!.callNotes).toEqual([]);
  });

  it('clears the legacy field on the write, so nothing can re-wrap it later', async () => {
    const fs = memoryFs({ [LEADS]: legacyOnDisk });
    await createFileStore(fs).mergeLeads('scottsdale', [lead()]);

    const written = JSON.parse((await fs.readText(LEADS))!) as Lead[];
    expect(written[0]!.callNote).toBeUndefined();
    expect(written[0]!.callNotes).toHaveLength(1);
  });
});

describe('updateLead', () => {
  it('does not drop the note when the stored lead is still in the legacy shape', async () => {
    const fs = memoryFs({ [LEADS]: legacyOnDisk });
    const store = createFileStore(fs);

    const next = await store.updateLead('scottsdale', 'npi-1', { callStatus: 'follow-up' });

    expect(next!.callNotes).toHaveLength(1);
    expect(next!.callNotes![0]!.text).toBe('asked for a callback Tuesday');
    expect((await store.getLeads('scottsdale'))[0]!.callNotes).toHaveLength(1);
  });

  it('makes a deleted note stay deleted across a reload', async () => {
    const fs = memoryFs({ [LEADS]: legacyOnDisk });
    const store = createFileStore(fs);

    await store.updateLead('scottsdale', 'npi-1', { callNotes: [] });

    expect((await store.getLeads('scottsdale'))[0]!.callNotes).toEqual([]);
    const written = JSON.parse((await fs.readText(LEADS))!) as Lead[];
    expect(written[0]!.callNote).toBeUndefined();
  });

  it('round-trips an appended note', async () => {
    const fs = memoryFs({ [LEADS]: legacyOnDisk });
    const store = createFileStore(fs);

    const migrated = (await store.getLeads('scottsdale'))[0]!.callNotes!;
    await store.updateLead('scottsdale', 'npi-1', {
      callNotes: [...migrated, { id: 'n2', text: 'emailed the office', createdAt: '2026-02-02T09:00:00.000Z' }],
    });

    const got = (await store.getLeads('scottsdale'))[0]!;
    expect(got.callNotes!.map((n) => n.text)).toEqual(['asked for a callback Tuesday', 'emailed the office']);
  });
});
