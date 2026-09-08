import { rescore } from './score';
import type { MergeReport } from './store/types';
import type { Lead, ScanProgress, Territory } from './types';

/**
 * What a finished run means for the box.
 *
 * A stop is not a failure and not a completion: it keeps every lead found and
 * says so (R2, R14), and it must never leave the box looking fully scanned
 * (R4). None of that is decidable inside `runScan` - it needs the merge report
 * too - and none of it is testable inside a `.tsx` file, because this repo has
 * no DOM test environment. So the decision lives here and the component stays
 * thin (KTD5).
 */

/** The two stamps that say how far the box has been searched (KTD4). */
export interface ScanStateFields {
  lastScanAt: string | null;
  lastPartialScanAt: string | null;
}

export type TerritoryScanState = 'never' | 'partial' | 'complete';

export interface ScanResultInput {
  /** From the scan outcome: she pressed Stop. */
  cancelled: boolean;
  report: MergeReport;
  /** The box as it stood before this run. A stop must not disturb its history. */
  territory: Pick<Territory, 'lastScanAt' | 'lastPartialScanAt'>;
  /** Passed in rather than read from the clock, so the derivation stays pure. */
  at: string;
}

export interface DerivedScanResult {
  /** What the box now holds, per the merge - not what this run happened to find. */
  leadCount: number;
  scanState: ScanStateFields;
  phase: ScanProgress['phase'];
  message: string;
}

export function deriveScanResult(input: ScanResultInput): DerivedScanResult {
  const { report, at } = input;

  if (input.cancelled) {
    return {
      leadCount: report.total,
      scanState: {
        // Untouched on purpose. On a stopped rescan the old stamp is still the
        // truth about the last run that did finish; on a first scan it stays
        // null, and the partial stamp below is what stops the box reading as
        // never scanned.
        lastScanAt: input.territory.lastScanAt ?? null,
        lastPartialScanAt: at,
      },
      phase: 'cancelled',
      message: report.total
        ? 'Stopped — kept ' + report.total + ' leads (' + report.added + ' new this run)'
        : 'Stopped — nothing found before the stop',
    };
  }

  return {
    leadCount: report.total,
    scanState: {
      lastScanAt: at,
      // Reaching the end of the box is the only thing that retires an earlier
      // stop. Leaving it set would keep offering partial-scan wording forever.
      lastPartialScanAt: null,
    },
    phase: 'done',
    message:
      report.added + ' new, ' + report.updated + ' updated, ' + report.total + ' total',
  };
}

/**
 * Three states, not the two a single nullable timestamp can express. The
 * partial stamp wins where both are set, because a completed scan clears it -
 * so its presence means the most recent run was the one that stopped.
 */
export function territoryScanState(
  t: Pick<Territory, 'lastScanAt' | 'lastPartialScanAt'>,
): TerritoryScanState {
  if (t.lastPartialScanAt) return 'partial';
  if (t.lastScanAt) return 'complete';
  return 'never';
}

export interface EmailHuntInput {
  cancelled: boolean;
  /** Leads that gained an address during this hunt. */
  gained: number;
  resolved: number;
  rejected: number;
  leadCount: number;
}

export interface DerivedEmailHuntResult {
  phase: ScanProgress['phase'];
  message: string;
  leadCount: number;
}

/**
 * The same honesty for the second pass (R3, R14). A stopped hunt that reports
 * "Found 7 more emails" under a completed phase claims it worked the whole box
 * when she stopped it a tenth of the way in.
 */
export function deriveEmailHuntResult(input: EmailHuntInput): DerivedEmailHuntResult {
  const rejectedNote = input.rejected
    ? ' · ' + input.rejected + ' rejected as someone else'
    : '';
  const sites = ' · ' + input.resolved + ' websites guessed';

  return {
    phase: input.cancelled ? 'cancelled' : 'done',
    message: input.cancelled
      ? 'Stopped — kept ' + input.gained + ' new emails' + sites + rejectedNote
      : 'Found ' + input.gained + ' more emails' + sites + rejectedNote,
    leadCount: input.leadCount,
  };
}

/** Fields the email hunt is allowed to write. Everything else is hers. */
type EnrichedFields = Pick<
  Lead,
  'website' | 'email' | 'emailConfidence' | 'contactFormUrl' | 'enrichedAt'
>;

/**
 * Fold a hunt's findings onto what is on disk right now.
 *
 * The hunt runs for minutes off a snapshot of the lead list taken when it
 * started, so writing that array back destroys every status and note she set
 * while it ran (R15). Re-reading and folding in only the enrichment fields
 * costs one read and makes the two writers independent.
 */
export function mergeEnrichment(stored: Lead[], enriched: Lead[]): Lead[] {
  const found = new Map(enriched.map((l) => [l.id, l]));

  // Driven by what the store holds now, not by what the hunt saw. A lead she
  // deleted mid-hunt is simply absent here, so nothing resurrects it (R5).
  return stored.map((prior) => {
    const fresh = found.get(prior.id);
    if (!fresh) return prior;

    const patch: EnrichedFields = {
      // A hunt that came back empty-handed for a lead knows less than the
      // record already did; it never blanks what is there.
      website: fresh.website ?? prior.website,
      email: fresh.email ?? prior.email,
      emailConfidence: fresh.email ? fresh.emailConfidence : prior.emailConfidence,
      contactFormUrl: fresh.contactFormUrl ?? prior.contactFormUrl,
      enrichedAt: fresh.enrichedAt ?? prior.enrichedAt,
    };
    /**
     * Rescored, because a website or an email is worth points and this fold is
     * now the only thing that writes them. The hunt scores its own copies, but
     * only the enrichment fields survive the fold - so without this a lead that
     * just gained a site kept its pre-hunt score and stayed where it was in the
     * call order, which is the one thing the score exists to decide.
     */
    return rescore({ ...prior, ...patch });
  });
}
