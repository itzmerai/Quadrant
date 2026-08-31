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

  if (opts.enrichWebsites !== false && leads.length) {
    const osm = await enrichFromOsm(leads, territory.bbox, http, onProgress, cancel);
    leads = osm.leads;
    osmPlaces = osm.osmPlaces;
    osmMatched = osm.matched;
    if (osmPlaces === 0) {
      warnings.push(
        'OpenStreetMap lookup returned nothing, so no websites were recovered. ' +
          'The public Overpass service is rate-limited; try again in a minute.',
      );
    }
  }

  if (opts.guessDomains && leads.length) {
    const guessed = await guessWebsites(leads, http, onProgress, cancel);
    leads = guessed.leads;
    domainsGuessed = guessed.resolved;
    domainsRejected = guessed.rejected;
  }

  if (opts.crawlEmails && leads.length) {
    const crawl = await crawlForEmails(leads, http, onProgress, cancel);
    leads = crawl.leads;
    crawlAttempted = crawl.attempted;
    emailsFound = crawl.found;
  }

  leads.sort((a, b) => b.score - a.score);

  onProgress?.({
    phase: 'done',
    message: 'Found ' + leads.length + ' practices',
    current: 1,
    total: 1,
    leadsFound: leads.length,
  });

  return {
    leads,
    warnings,
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
