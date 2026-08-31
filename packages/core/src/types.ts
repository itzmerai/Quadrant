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
}

export type CountryCode = 'US' | 'UK' | 'AU' | 'CA' | 'OTHER';

export type CallStatus =
  | 'new'
  | 'queued'
  | 'called'
  | 'voicemail'
  | 'callback'
  | 'interested'
  | 'not-interested'
  | 'do-not-contact';

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
