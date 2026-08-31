import type { Lead, Territory } from '../types';
import type { FsAdapter, MergeReport, TerritoryStore } from './types';

/**
 * One folder per named box. The folder name is the territory slug, so the
 * data on disk is browsable and obvious:
 *
 *   territories/scottsdale-dentists/territory.json
 *   territories/scottsdale-dentists/leads.json
 */
const ROOT = 'territories';

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'territory'
  );
}

/** Slug collisions get a numeric suffix rather than silently overwriting. */
export function uniqueSlug(name: string, taken: Set<string>): string {
  const base = slugify(name);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 500; i++) {
    const candidate = base + '-' + i;
    if (!taken.has(candidate)) return candidate;
  }
  return base + '-' + Date.now();
}

const territoryPath = (id: string) => ROOT + '/' + id + '/territory.json';
const leadsPath = (id: string) => ROOT + '/' + id + '/leads.json';

export function createFileStore(fs: FsAdapter): TerritoryStore {
  async function readJson<T>(path: string, fallback: T): Promise<T> {
    try {
      const raw = await fs.readText(path);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  return {
    async listTerritories() {
      await fs.mkdir(ROOT);
      const dirs = await fs.listDirs(ROOT);
      const out: Territory[] = [];
      for (const dir of dirs) {
        const t = await readJson<Territory | null>(territoryPath(dir), null);
        if (t) out.push(t);
      }
      // Most recently scanned first; never-scanned boxes sort by creation.
      return out.sort((a, b) => {
        const at = a.lastScanAt ?? a.createdAt;
        const bt = b.lastScanAt ?? b.createdAt;
        return bt.localeCompare(at);
      });
    },

    async getTerritory(id) {
      return readJson<Territory | null>(territoryPath(id), null);
    },

    async saveTerritory(t) {
      await fs.mkdir(ROOT + '/' + t.id);
      await fs.writeText(territoryPath(t.id), JSON.stringify(t, null, 2));
    },

    async deleteTerritory(id) {
      await fs.remove(ROOT + '/' + id);
    },

    async getLeads(territoryId) {
      return readJson<Lead[]>(leadsPath(territoryId), []);
    },

    async saveLeads(territoryId, leads) {
      await fs.mkdir(ROOT + '/' + territoryId);
      await fs.writeText(leadsPath(territoryId), JSON.stringify(leads, null, 2));
    },

    async mergeLeads(territoryId, incoming): Promise<MergeReport> {
      const existing = await readJson<Lead[]>(leadsPath(territoryId), []);
      const byId = new Map(existing.map((l) => [l.id, l]));

      let added = 0;
      let updated = 0;
      let unchanged = 0;

      for (const fresh of incoming) {
        const prior = byId.get(fresh.id);
        if (!prior) {
          byId.set(fresh.id, fresh);
          added++;
          continue;
        }

        // Registry data refreshes; her working state never gets clobbered.
        const merged: Lead = {
          ...fresh,
          callStatus: prior.callStatus,
          callNote: prior.callNote,
          lastCalledAt: prior.lastCalledAt,
          // Keep enrichment that the registry cannot supply.
          website: fresh.website ?? prior.website,
          email: fresh.email ?? prior.email,
          enrichedAt: prior.enrichedAt,
        };

        const changed =
          prior.phone !== merged.phone ||
          prior.contactName !== merged.contactName ||
          prior.contactPhone !== merged.contactPhone ||
          prior.practiceName !== merged.practiceName ||
          prior.address !== merged.address;

        byId.set(fresh.id, merged);
        if (changed) updated++;
        else unchanged++;
      }

      const all = [...byId.values()].sort((a, b) => b.score - a.score);
      await fs.mkdir(ROOT + '/' + territoryId);
      await fs.writeText(leadsPath(territoryId), JSON.stringify(all, null, 2));

      return { added, updated, unchanged, total: all.length };
    },

    async updateLead(territoryId, leadId, patch) {
      const leads = await readJson<Lead[]>(leadsPath(territoryId), []);
      const i = leads.findIndex((l) => l.id === leadId);
      if (i < 0) return null;
      const next = { ...leads[i]!, ...patch };
      leads[i] = next;
      await fs.writeText(leadsPath(territoryId), JSON.stringify(leads, null, 2));
      return next;
    },
  };
}
