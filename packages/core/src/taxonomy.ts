/**
 * Which practices a medical VA can realistically win.
 *
 * The shape of the filter matters more than its length: small, owner-operated
 * practices outsource scheduling, intake and billing. Hospital systems,
 * assisted-living operators and equipment suppliers have procurement
 * departments and will not hire a VA, so they are excluded outright.
 */
export interface SpecialtyGroup {
  key: string;
  label: string;
  /** Passed to the NPPES `taxonomy_description` parameter (partial match). */
  terms: string[];
  /** On by default in the UI - the highest-conversion niches. */
  preset: boolean;
  hint: string;
}

export const SPECIALTY_GROUPS: SpecialtyGroup[] = [
  {
    key: 'dental', label: 'Dental', terms: ['Dentist'], preset: true,
    hint: 'Highest VA adoption. Heavy scheduling and insurance verification load.',
  },
  {
    key: 'chiro', label: 'Chiropractic', terms: ['Chiropractor'], preset: true,
    hint: 'Almost always owner-operated. Very high call volume per practice.',
  },
  {
    key: 'physical-therapy', label: 'Physical therapy', terms: ['Physical Therapist'], preset: true,
    hint: 'Recurring appointments mean constant rescheduling work.',
  },
  {
    key: 'family-medicine', label: 'Family medicine', terms: ['Family Medicine'], preset: true,
    hint: 'Small primary-care offices with chronic front-desk understaffing.',
  },
  {
    key: 'mental-health', label: 'Mental health',
    terms: ['Psychologist', 'Counselor', 'Clinical Social Worker', 'Marriage'], preset: true,
    hint: 'Solo practitioners with no admin staff at all. Strong fit.',
  },
  {
    key: 'optometry', label: 'Optometry', terms: ['Optometrist'], preset: true,
    hint: 'Retail-adjacent, appointment driven, small teams.',
  },
  {
    key: 'podiatry', label: 'Podiatry', terms: ['Podiatrist'], preset: true,
    hint: 'Small practices with heavy insurance pre-authorization work.',
  },
  {
    key: 'dermatology', label: 'Dermatology', terms: ['Dermatology'], preset: false,
    hint: 'Often better staffed, but cosmetic practices convert well.',
  },
  {
    key: 'internal-medicine', label: 'Internal medicine', terms: ['Internal Medicine'], preset: false,
    hint: 'Broad category - expect some hospital-affiliated noise.',
  },
  {
    key: 'pediatrics', label: 'Pediatrics', terms: ['Pediatrics'], preset: false,
    hint: 'High call volume, though many belong to larger groups.',
  },
  {
    key: 'obgyn', label: 'OB/GYN', terms: ['Obstetrics'], preset: false,
    hint: 'Prior-authorization heavy.',
  },
  {
    key: 'acupuncture', label: 'Acupuncture', terms: ['Acupuncturist'], preset: false,
    hint: 'Cash-pay, tiny teams, low competition from other VAs.',
  },
  {
    key: 'speech-ot', label: 'Speech and occupational therapy',
    terms: ['Speech-Language Pathologist', 'Occupational Therapist'], preset: false,
    hint: 'Recurring-appointment model, often solo.',
  },
  {
    key: 'plastic-surgery', label: 'Plastic surgery and med spa', terms: ['Plastic Surgery'], preset: false,
    hint: 'Cash-pay and marketing-minded - receptive to outsourced intake.',
  },
];

/**
 * Dropped even when a taxonomy term matches. These have procurement
 * departments, not a doctor who picks up the phone.
 */
export const EXCLUDED_PATTERNS: RegExp[] = [
  /hospital/i,
  /assisted living/i,
  /nursing/i,
  /home health/i,
  /hospice/i,
  /durable medical equipment/i,
  /supplies/i,
  /pharmacy/i,
  /clinical medical laboratory/i,
  /ambulance/i,
  /transportation/i,
  /residential treatment/i,
  /military/i,
  /veterans/i,
  /health system/i,
  /managed care/i,
  /health plan/i,
  /emergency medical/i,
  /blood bank/i,
];

/** Organization names that signal a large group rather than a small practice. */
export const LARGE_ORG_PATTERNS: RegExp[] = [
  /health system/i,
  /healthcare system/i,
  /medical center/i,
  /\bhospital\b/i,
  /university/i,
  /holdings/i,
  /\bcorporation\b/i,
];

export function groupByKey(key: string): SpecialtyGroup | undefined {
  return SPECIALTY_GROUPS.find((g) => g.key === key);
}

export function presetKeys(): string[] {
  return SPECIALTY_GROUPS.filter((g) => g.preset).map((g) => g.key);
}

export function isExcludedTaxonomy(desc: string): boolean {
  return EXCLUDED_PATTERNS.some((re) => re.test(desc));
}

export function looksLikeLargeOrg(name: string): boolean {
  return LARGE_ORG_PATTERNS.some((re) => re.test(name));
}

/** Map a raw NPPES taxonomy description back to one of our group keys. */
export function groupForTaxonomy(desc: string): string {
  for (const g of SPECIALTY_GROUPS) {
    if (g.terms.some((t) => desc.toLowerCase().includes(t.toLowerCase()))) return g.key;
  }
  return 'other';
}
