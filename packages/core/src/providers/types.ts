import type { BBox, CountryCode, Lead, ProgressFn } from '../types';
import type { CancelToken, Http } from '../http';
import type { ZipIndex } from '../zip/resolver';

export interface SearchRequest {
  bbox: BBox;
  territoryId: string;
  /** Specialty group keys from taxonomy.ts. Empty means every preset group. */
  specialties: string[];
  http: Http;
  zipIndex: ZipIndex;
  onProgress?: ProgressFn;
  cancel?: CancelToken;
  /** Also pull individual practitioners (NPI-1), not just practice entities. */
  includeIndividuals?: boolean;
}

export interface SearchResult {
  leads: Lead[];
  /** Any ZIP or tile that hit the source's result ceiling and may be incomplete. */
  truncated: string[];
  queriesRun: number;
  warnings: string[];
}

/**
 * One implementation per country. The bounding box is the universal input;
 * how a provider turns that into a query is its own business - NPPES resolves
 * it to ZIP codes, Overpass takes it natively.
 */
export interface RegistryProvider {
  id: string;
  label: string;
  country: CountryCode;
  /** Shown in the UI before a scan so nobody is sold a promise the data cannot keep. */
  coverage: 'excellent' | 'good' | 'partial' | 'weak';
  coverageNote: string;
  requiresKey: boolean;
  search(req: SearchRequest): Promise<SearchResult>;
}
