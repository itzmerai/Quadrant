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
  lastScanAt: string | null;
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
 */
export type CallStatus =
  | 'new'
  | 'no-answer'
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

/** Stored leads predate this list, so an unknown value resolves rather than breaks. */
export function normalizeCallStatus(raw: string | undefined | null): CallStatus {
  if (!raw) return 'new';
  const known: CallStatus[] = [
    'new', 'no-answer', 'follow-up', 'interested', 'do-not-contact',
  ];
  if ((known as string[]).includes(raw)) return raw as CallStatus;
  return LEGACY_STATUS[raw] ?? 'new';
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
  callNote?: string;
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
