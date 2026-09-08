/** Geographic bounding box. Stored as two corners: south-west and north-east. */
export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** A named box the user drew on the map. Owns its leads and its call progress. */
export interface Territory {
  id: string;
  name: string;
  bbox: BBox;
  country: CountryCode;
  /** Taxonomy group keys the user scanned for, e.g. ["dental", "chiro"]. */
  specialties: string[];
  createdAt: string;
  /** When the box was last searched all the way to the end. */
  lastScanAt: string | null;
  /**
   * When a scan of this box was last stopped part-way (KTD4). A box has three
   * states and one nullable timestamp can only express two: without this, a box
   * holding 800 leads from a stopped first scan reads as never scanned, and a
   * stopped rescan is indistinguishable from one that finished. Optional so
   * that territory documents written before it existed still load.
   */
  lastPartialScanAt?: string | null;
  leadCount: number;
  /** Freeform note — "referred by Anna", "reprice in Q2". */
  note?: string;
  /** Swatch key from TERRITORY_COLORS. Tints the map box and the sidebar entry. */
  color?: string;
}

export type CountryCode = 'US' | 'UK' | 'AU' | 'CA' | 'OTHER';

/**
 * Call outcomes, one per distinct next action.
 *
 * Deliberately short: a status she has to think about is a status she will not
 * set mid-call. Dropped along the way were `queued` (a lead she intends to call
 * is just new) and `called` (every other value already implies she called).
 * `voicemail` and `callback` both mean "reached out, waiting" and merged into
 * `follow-up`.
 *
 * `reached-out` is the opposite case and stays separate for that reason (R6):
 * an email or a contact form went out and *no* conversation happened, so there
 * is nothing to follow up on yet. One value covers every non-call channel —
 * splitting it per channel would push the pill list past what she can scan.
 */
export type CallStatus =
  | 'new'
  | 'no-answer'
  | 'reached-out'
  | 'follow-up'
  | 'interested'
  | 'do-not-contact';

/** Values written by earlier builds, mapped to the status that replaced them. */
const LEGACY_STATUS: Record<string, CallStatus> = {
  queued: 'new',
  called: 'no-answer',
  voicemail: 'follow-up',
  callback: 'follow-up',
  // Both mean stop calling; the softer wording is the one that went away.
  'not-interested': 'do-not-contact',
};

/**
 * Every current status, in the order a lead moves through them.
 *
 * Typed as a total `Record` so adding a value to `CallStatus` fails to compile
 * until it is listed here. It used to be a plain array, which meant a new
 * status would quietly normalize to `new` on load instead of erroring - the
 * failure would surface as leads silently losing their status, not as a build
 * break. The UI reads the derived list rather than retyping the values.
 */
const CURRENT_STATUS: Record<CallStatus, true> = {
  'new': true,
  'no-answer': true,
  'reached-out': true,
  'follow-up': true,
  'interested': true,
  'do-not-contact': true,
};

/** Presentation order for pickers and filters; key order carries the intent. */
export const CALL_STATUSES = Object.keys(CURRENT_STATUS) as CallStatus[];

/** Stored leads predate this list, so an unknown value resolves rather than breaks. */
export function normalizeCallStatus(raw: string | undefined | null): CallStatus {
  if (!raw) return 'new';
  // Runs once per lead on every store read, so it stays an O(1) lookup against
  // a hoisted constant rather than rebuilding a list per call.
  if (Object.prototype.hasOwnProperty.call(CURRENT_STATUS, raw)) return raw as CallStatus;
  return LEGACY_STATUS[raw] ?? 'new';
}

/**
 * One dated entry in a lead's call history (R7).
 *
 * `createdAt` is when the note was written and never moves: an edit corrects
 * what was said, it does not re-date the conversation.
 */
export interface Note {
  id: string;
  text: string;
  /**
   * ISO timestamp. For a note migrated from the old single free-text field
   * this is sourced from the lead's own record, never minted at read time,
   * so the date does not change between launches (KTD11).
   */
  createdAt: string;
}

/** One prospect. Everything the VA needs to make the call, in call order. */
export interface Lead {
  id: string;
  territoryId: string;

  practiceName: string;
  specialty: string;
  /** Grouping key from taxonomy.ts, e.g. "dental". */
  specialtyGroup: string;

  phone: string | null;
  /** Named decision-maker from the NPPES authorized-official fields. */
  contactName: string | null;
  contactTitle: string | null;
  contactPhone: string | null;

  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lon: number | null;
  timezone: string | null;

  website: string | null;
  email: string | null;
  /** published = found on their site. guessed = inferred, domain accepts mail. */
  emailConfidence?: 'published' | 'guessed';
  /** Where to reach practices that publish a form instead of an address. */
  contactFormUrl?: string | null;

  /** ISO date the practice was first enumerated — proxy for practice age. */
  enumeratedAt: string | null;
  /** ISO date the registry record was last touched — proxy for freshness. */
  recordUpdatedAt: string | null;

  score: number;
  scoreReasons: string[];

  callStatus: CallStatus;
  /**
   * @deprecated The old single free-text note, replaced by `callNotes` (R7).
   * Still on the type so records written before the list existed parse; the
   * store migrates it on read and clears it on the next write (KTD11).
   */
  callNote?: string;
  /**
   * Dated note history, oldest first. The presence of this key is
   * authoritative even when the list is empty — an empty list means she
   * deleted every note, and must never be re-derived from `callNote` (KTD11).
   */
  callNotes?: Note[];
  lastCalledAt?: string | null;

  /** Other practices registered at this same phone number. */
  relatedCount?: number;
  relatedNames?: string[];
  relatedNpis?: string[];

  source: string;
  sourceId: string;
  fetchedAt: string;
  enrichedAt?: string | null;
}

export interface ScanProgress {
  phase: 'resolving' | 'querying' | 'filtering' | 'enriching' | 'done' | 'cancelled' | 'error';
  message: string;
  current: number;
  total: number;
  leadsFound: number;
}

export type ProgressFn = (p: ScanProgress) => void;
