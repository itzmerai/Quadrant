import type { Note } from './types';

/**
 * Add, edit, delete and migrate a lead's dated call notes (R7-R11).
 *
 * All of it is pure array work, so it lives here rather than in the React row
 * that renders it (KTD5): there is no DOM test environment in this repo, and
 * losing a note is the one failure the VA would never forgive.
 */

/** The lead fields the migration reads. Kept narrow so tests can build one. */
export interface LegacyNoteSource {
  id: string;
  /** @deprecated The pre-list single note. */
  callNote?: string;
  lastCalledAt?: string | null;
  fetchedAt?: string;
}

/**
 * The id a migrated note gets, derived from the lead rather than minted.
 *
 * `getLeads`, `mergeLeads` and `updateLead` all migrate independently, and
 * they can each run against the same record before anything is written back.
 * A random id would give the three read paths three different notes, so a
 * delete issued against one would not match the note another had just saved.
 */
export function legacyNoteId(leadId: string): string {
  return 'legacy:' + leadId;
}

let seq = 0;

/** Time-ordered and unique within a session; ids are opaque keys, not data. */
function newNoteId(now: Date): string {
  seq = (seq + 1) % 1_000_000;
  return 'n' + now.getTime().toString(36) + '-' + seq.toString(36);
}

function isNote(v: unknown): v is Note {
  if (!v || typeof v !== 'object') return false;
  const n = v as Partial<Note>;
  return typeof n.id === 'string' && typeof n.text === 'string' && typeof n.createdAt === 'string';
}

/**
 * The note list for a lead, whichever shape the stored record is in (KTD11).
 *
 * `raw` is the stored `callNotes` value. Its *presence* is authoritative: an
 * empty list means she deleted every note, and re-deriving from `callNote`
 * would resurrect a deleted note on the next read. Only a record with no list
 * at all falls back to wrapping the old single field.
 */
export function normalizeCallNotes(raw: unknown, lead: LegacyNoteSource): Note[] {
  if (Array.isArray(raw)) {
    // Most leads have no notes, and this runs per lead on every store read, so
    // the empty case skips the filter/map pair rather than allocating twice.
    if (raw.length === 0) return raw as Note[];
    // A hand-edited or half-written file should cost the bad entry, not the row.
    return raw.filter(isNote).map((n) => ({ id: n.id, text: n.text, createdAt: n.createdAt }));
  }

  const text = (lead.callNote ?? '').trim();
  if (!text) return [];

  return [
    {
      id: legacyNoteId(lead.id),
      text,
      // Sourced from the record, never from the clock, so the migrated note
      // shows the same date on every launch. `lastCalledAt` is when she last
      // worked the lead and is the closest thing to when the note was written;
      // `fetchedAt` bounds it from below for a lead she noted but never called.
      createdAt: lead.lastCalledAt || lead.fetchedAt || '',
    },
  ];
}

/** Appends a note. A blank one is not a note, so it is dropped silently. */
export function addNote(notes: Note[] | undefined, text: string, now: Date = new Date()): Note[] {
  const list = notes ?? [];
  const trimmed = text.trim();
  if (!trimmed) return list;
  return [...list, { id: newNoteId(now), text: trimmed, createdAt: now.toISOString() }];
}

/**
 * Rewrites one note's text. Its id and date are untouched: an edit corrects
 * what was said, so the entry keeps its place in the history.
 *
 * Emptying a note is how she removes one from inside the edit box, so it
 * deletes rather than leaving a blank bullet behind.
 */
export function editNote(notes: Note[] | undefined, id: string, text: string): Note[] {
  const list = notes ?? [];
  const trimmed = text.trim();
  if (!trimmed) return deleteNote(list, id);
  return list.map((n) => (n.id === id ? { ...n, text: trimmed } : n));
}

export function deleteNote(notes: Note[] | undefined, id: string): Note[] {
  return (notes ?? []).filter((n) => n.id !== id);
}
