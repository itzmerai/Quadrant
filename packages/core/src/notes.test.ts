import { describe, expect, it } from 'vitest';
import { addNote, deleteNote, editNote, normalizeCallNotes } from './notes';
import { CALL_SHEET_COLUMNS, leadsToCsv } from './export/csv';
import type { Lead, Note } from './types';

/** Only the fields the note module actually reads; the rest is noise here. */
function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: 'npi-1',
    territoryId: 't',
    practiceName: 'Ironwood Dental',
    specialty: 'Dentist',
    specialtyGroup: 'dental',
    phone: null,
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
    sourceId: '1',
    fetchedAt: '2026-01-05T09:00:00.000Z',
    ...over,
  };
}

const note = (id: string, text: string, createdAt = '2026-02-01T10:00:00.000Z'): Note => ({
  id,
  text,
  createdAt,
});

describe('normalizeCallNotes', () => {
  it('wraps a legacy string into one note dated from the lead, not the clock', () => {
    const l = lead({ callNote: 'asked for a callback Tuesday', lastCalledAt: '2026-01-20T17:30:00.000Z' });
    const notes = normalizeCallNotes(l.callNotes, l);

    expect(notes).toHaveLength(1);
    expect(notes[0]!.text).toBe('asked for a callback Tuesday');
    expect(notes[0]!.createdAt).toBe('2026-01-20T17:30:00.000Z');
  });

  it('falls back to fetchedAt when the lead was never called', () => {
    const l = lead({ callNote: 'emailed the front desk', lastCalledAt: null });
    expect(normalizeCallNotes(l.callNotes, l)[0]!.createdAt).toBe('2026-01-05T09:00:00.000Z');
  });

  it('gives the migrated note the same id every time it is read', () => {
    // Two read paths (getLeads and mergeLeads) migrate the same record before
    // the first write. If they minted different ids, a delete on one would not
    // match the note the other wrote.
    const l = lead({ callNote: 'left a voicemail' });
    expect(normalizeCallNotes(l.callNotes, l)[0]!.id).toBe(normalizeCallNotes(l.callNotes, l)[0]!.id);
    expect(normalizeCallNotes(l.callNotes, l)[0]!.id).toBeTruthy();
  });

  it('returns an existing list unchanged', () => {
    const list = [note('a', 'first'), note('b', 'second')];
    const l = lead({ callNotes: list });
    expect(normalizeCallNotes(l.callNotes, l)).toEqual(list);
  });

  it('returns an empty list for undefined, null, empty and whitespace-only notes', () => {
    expect(normalizeCallNotes(undefined, lead())).toEqual([]);
    expect(normalizeCallNotes(null, lead())).toEqual([]);
    expect(normalizeCallNotes(undefined, lead({ callNote: '' }))).toEqual([]);
    expect(normalizeCallNotes(undefined, lead({ callNote: '   \n\t ' }))).toEqual([]);
  });

  it('lets an empty list beat a legacy string that is still on the record', () => {
    // She deleted the migrated note. Re-wrapping the old string here would
    // silently resurrect it on the next read (KTD11).
    const l = lead({ callNote: 'asked for a callback Tuesday', callNotes: [] });
    expect(normalizeCallNotes(l.callNotes, l)).toEqual([]);
  });

  it('drops malformed entries rather than rendering a blank note', () => {
    const raw = [note('a', 'kept'), { id: 'b' }, null, 'nope'];
    expect(normalizeCallNotes(raw, lead()).map((n) => n.text)).toEqual(['kept']);
  });
});

describe('addNote', () => {
  it('appends and leaves earlier notes untouched', () => {
    const before = [note('a', 'first')];
    const after = addNote(before, 'second', new Date('2026-03-01T12:00:00.000Z'));

    expect(after).toHaveLength(2);
    expect(after[0]).toEqual(before[0]);
    expect(after[1]!.text).toBe('second');
    expect(after[1]!.createdAt).toBe('2026-03-01T12:00:00.000Z');
    expect(before).toHaveLength(1);
  });

  it('starts a list when the lead has none', () => {
    expect(addNote(undefined, 'first')).toHaveLength(1);
  });

  it('refuses a blank note rather than adding an empty row', () => {
    expect(addNote([note('a', 'first')], '   ')).toEqual([note('a', 'first')]);
  });

  it('gives each note a distinct id', () => {
    const now = new Date('2026-03-01T12:00:00.000Z');
    const two = addNote(addNote([], 'one', now), 'two', now);
    expect(two[0]!.id).not.toBe(two[1]!.id);
  });
});

describe('editNote', () => {
  it('changes only that note and keeps its id and date', () => {
    const before = [note('a', 'first', '2026-01-01T00:00:00.000Z'), note('b', 'second')];
    const after = editNote(before, 'a', 'first, corrected');

    expect(after[0]).toEqual({ id: 'a', text: 'first, corrected', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(after[1]).toEqual(before[1]);
  });

  it('deletes a note edited down to whitespace instead of leaving a blank bullet', () => {
    const after = editNote([note('a', 'first'), note('b', 'second')], 'a', '  ');
    expect(after.map((n) => n.id)).toEqual(['b']);
  });

  it('leaves the list alone when the id is not there', () => {
    const before = [note('a', 'first')];
    expect(editNote(before, 'missing', 'x')).toEqual(before);
  });
});

describe('deleteNote', () => {
  it('removes only that note', () => {
    const after = deleteNote([note('a', 'first'), note('b', 'second'), note('c', 'third')], 'b');
    expect(after.map((n) => n.id)).toEqual(['a', 'c']);
  });

  it('tolerates a list it has already been removed from', () => {
    expect(deleteNote([note('a', 'first')], 'b').map((n) => n.id)).toEqual(['a']);
  });
});

/**
 * The Notes column lives in csv.ts but is entirely about this module's shape,
 * and the repo has no csv.test.ts to grow; keeping it here keeps the note
 * contract - text, order, and one cell - in one file.
 */
describe('CSV Notes column', () => {
  const notesCell = (l: Lead) =>
    String(CALL_SHEET_COLUMNS.find((c) => c.header === 'Notes')!.get(l));

  it('carries every note, oldest first, in one cell', () => {
    const l = lead({
      callNotes: [
        note('n1', 'left a voicemail', '2026-01-10T10:00:00.000Z'),
        note('n2', 'spoke to Dana, send pricing', '2026-01-14T10:00:00.000Z'),
      ],
    });
    expect(notesCell(l)).toBe('left a voicemail\nspoke to Dana, send pricing');
  });

  it('quotes the multi-note cell so a newline cannot break the row', () => {
    const csv = leadsToCsv([
      lead({ callNotes: [note('n1', 'first'), note('n2', 'second')] }),
    ]);
    expect(csv).toContain('"first\nsecond"');
  });

  it('renders an empty cell for a lead with no notes', () => {
    expect(notesCell(lead())).toBe('');
    expect(notesCell(lead({ callNotes: [] }))).toBe('');
  });

  it('still exports a pre-list note for a lead that never passed through the store', () => {
    expect(notesCell(lead({ callNote: 'asked for a callback Tuesday' })))
      .toBe('asked for a callback Tuesday');
  });
});
