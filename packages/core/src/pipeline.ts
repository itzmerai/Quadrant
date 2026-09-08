import type { Lead, ProgressFn, Territory } from './types';
import type { Http, CancelToken } from './http';
import type { ZipIndex } from './zip/resolver';
import { nppesProvider } from './providers/nppes';
import { enrichFromOsm } from './enrich/osmMatch';
import { crawlForEmails } from './enrich/crawl';
import { guessWebsites } from './enrich/domainGuess';
import { presetKeys } from './taxonomy';
import { dedupeByPhone } from './dedupe';

export interface ScanOptions {
  territory: Territory;
  http: Http;
  zipIndex: ZipIndex;
  onProgress?: ProgressFn;
  cancel?: CancelToken;
  /** Look up websites in OpenStreetMap. Cheap, one request. */
  enrichWebsites?: boolean;
  /** Crawl those websites for an email. Slower - one request per practice. */
  crawlEmails?: boolean;
  /** Guess domains for practices with no known site. Slow but roughly doubles reach. */
  guessDomains?: boolean;
}

export interface ScanOutcome {
  leads: Lead[];
  warnings: string[];
  /**
   * The user pressed Stop. Everything found before that is in `leads` and is
   * meant to be saved exactly as a completed scan would be; the difference is
   * only that the box was not searched to the end.
   */
  cancelled: boolean;
  stats: {
    found: number;
    queriesRun: number;
    osmPlaces: number;
    osmMatched: number;
    crawlAttempted: number;
    emailsFound: number;
    duplicatesMerged: number;
    domainsGuessed: number;
    domainsRejected: number;
    elapsedMs: number;
  };
}

/**
 * The whole run: find practices, then top up what the registry cannot supply.
 *
 * Enrichment is deliberately allowed to fail without failing the scan. A call
 * sheet with phone numbers and no emails is still a working call sheet; a scan
 * that throws because Overpass was rate-limited is not.
 *
 * Cancellation is the same principle one step further (KTD2). A stop from any
 * stage means "stop here and keep what we have": the remaining stages are
 * skipped, the leads already found are still deduped and ordered, and the
 * outcome comes back with `cancelled: true`. This function never throws a
 * cancellation to its caller - throwing is exactly what would skip the save.
 */
export async function runScan(opts: ScanOptions): Promise<ScanOutcome> {
  const started = Date.now();
  const { territory, http, zipIndex, onProgress, cancel } = opts;

  const search = await nppesProvider.search({
    bbox: territory.bbox,
    territoryId: territory.id,
    specialties: territory.specialties.length ? territory.specialties : presetKeys(),
    http,
    zipIndex,
    onProgress,
    cancel,
  });

  // Collapse before enriching: no point crawling the same office twice.
  const deduped = dedupeByPhone(search.leads);
  let leads = deduped.leads;
  const warnings = [...search.warnings];
  if (deduped.report.collapsed > 0) {
    warnings.push(
      'Merged ' + deduped.report.collapsed + ' duplicate registrations that share a phone ' +
      'number with another practice, so you never dial the same office twice.',
    );
  }
  let osmPlaces = 0;
  let osmMatched = 0;
  let crawlAttempted = 0;
  let emailsFound = 0;
  let domainsGuessed = 0;
  let domainsRejected = 0;
  // Once this is set every later stage is skipped: she asked for the scan to
  // stop, not for the next pass to start.
  let cancelled = search.cancelled;

  if (!cancelled && opts.enrichWebsites !== false && leads.length) {
    const osm = await enrichFromOsm(leads, territory.bbox, http, onProgress, cancel);
    leads = osm.leads;
    osmPlaces = osm.osmPlaces;
    osmMatched = osm.matched;
    cancelled = osm.cancelled;
    /**
     * Only when Overpass genuinely came back empty. A stopped lookup produces
     * exactly the same zero, so without the guard every single stop tells her
     * the service is rate-limited and to try again in a minute - a warning the
     * cancellation invented about a service that was working fine (R14).
     */
    if (!cancelled && osmPlaces === 0) {
      warnings.push(
        'OpenStreetMap lookup returned nothing, so no websites were recovered. ' +
          'The public Overpass service is rate-limited; try again in a minute.',
      );
    }
  }

  if (!cancelled && opts.guessDomains && leads.length) {
    const guessed = await guessWebsites(leads, http, onProgress, cancel);
    leads = guessed.leads;
    domainsGuessed = guessed.resolved;
    domainsRejected = guessed.rejected;
    cancelled = guessed.cancelled;
  }

  if (!cancelled && opts.crawlEmails && leads.length) {
    const crawl = await crawlForEmails(leads, http, onProgress, cancel);
    leads = crawl.leads;
    crawlAttempted = crawl.attempted;
    emailsFound = crawl.found;
    cancelled = crawl.cancelled;
  }

  // A stopped scan is still deduped and ordered. What she keeps has to be a
  // usable call sheet, not a raw partial dump.
  leads.sort((a, b) => b.score - a.score);

  // No terminal progress event here on purpose (KTD9). The caller still has to
  // merge and save what came back, and it is the caller's phase that unlocks
  // Delete and Rescan - announcing the end from in here unlocks them while the
  // territory folder is still being written.

  return {
    leads,
    warnings,
    cancelled,
    stats: {
      found: leads.length,
      queriesRun: search.queriesRun,
      osmPlaces,
      osmMatched,
      crawlAttempted,
      emailsFound,
      duplicatesMerged: deduped.report.collapsed,
      domainsGuessed,
      domainsRejected,
      elapsedMs: Date.now() - started,
    },
  };
}
