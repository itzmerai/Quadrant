import type { Lead, Territory } from '../types';

/**
 * Minimal filesystem surface. Backed by the Tauri fs plugin in the desktop
 * app and by localStorage in browser dev, so the store logic above it never
 * has to care which one it is talking to.
 */
export interface FsAdapter {
  readText(path: string): Promise<string | null>;
  writeText(path: string, contents: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  listDirs(path: string): Promise<string[]>;
  remove(path: string): Promise<void>;
}

export interface TerritoryStore {
  listTerritories(): Promise<Territory[]>;
  getTerritory(id: string): Promise<Territory | null>;
  saveTerritory(t: Territory): Promise<void>;
  deleteTerritory(id: string): Promise<void>;

  getLeads(territoryId: string): Promise<Lead[]>;
  saveLeads(territoryId: string, leads: Lead[]): Promise<void>;
  /**
   * Merge freshly scanned leads into whatever is already stored, preserving
   * call status and notes on leads she has already worked.
   */
  mergeLeads(territoryId: string, incoming: Lead[]): Promise<MergeReport>;
  updateLead(territoryId: string, leadId: string, patch: Partial<Lead>): Promise<Lead | null>;
}

export interface MergeReport {
  added: number;
  updated: number;
  unchanged: number;
  total: number;
}
