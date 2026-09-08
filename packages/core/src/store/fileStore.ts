import { normalizeCallStatus, type Lead, type Territory } from '../types';
import { normalizeCallNotes } from '../notes';
import type { FsAdapter, MergeReport, TerritoryStore } from './types';

/**
 * A stored lead brought up to the current shape.
 *
 * Every path that reads leads.json runs this, not just `getLeads` (KTD6):
 * `mergeLeads` and `updateLead` both read the file raw, so a rescan or a
 * status change against a box still holding the old single-note shape would
 * carry `callNotes` as undefined and drop the note with no error at all.
 *
 * The legacy `callNote` is stripped here, which means the next write of any
 * kind persists the migration and removes the second source of truth (KTD11).
 */
function normalizeLead(stored: Lead): Lead {
  return {
    ...stored,
    // Cleared rather than destructured away: this runs once per lead on every
    // read, and destructure-then-spread copies every field twice. `undefined`
    // is dropped by JSON.stringify, so the file ends up the same shape - the
    // merge path a hundred lines below already relies on exactly that.
    callNote: undefined,
    // Statuses from earlier builds resolve to their replacement rather than
    // rendering as an unknown pill.
    callStatus: normalizeCallStatus(stored.callStatus),
    callNotes: normalizeCallNotes(stored.callNotes, stored),
  };
}

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

/**
 * When a box was last worked, by either kind of run.
 *
 * Sorting on `lastScanAt` alone sank a box whose only scan was stopped back to
 * creation order - the one she is most likely to come back to. ISO-8601 strings
 * compare lexicographically, so the newest stamp is just the largest.
 */
function latestStamp(t: Territory): string {
  return [t.lastPartialScanAt, t.lastScanAt, t.createdAt].filter(Boolean).sort().pop()!;
}

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
        const at = latestStamp(a);
        const bt = latestStamp(b);
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
      const leads = await readJson<Lead[]>(leadsPath(territoryId), []);
      return leads.map(normalizeLead);
    },

    async saveLeads(territoryId, leads) {
      await fs.mkdir(ROOT + '/' + territoryId);
      await fs.writeText(leadsPath(territoryId), JSON.stringify(leads, null, 2));
    },

    async mergeLeads(territoryId, incoming): Promise<MergeReport> {
      // Migrated before anything is compared: a stored lead in the old shape
      // has to reach the preserve list below already carrying its notes (KTD6).
      const existing = (await readJson<Lead[]>(leadsPath(territoryId), [])).map(normalizeLead);
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
          callNotes: prior.callNotes,
          // The scan cannot know about the old single field, and `prior` no
          // longer carries it, so the merge writes the migrated list alone.
          callNote: undefined,
          lastCalledAt: prior.lastCalledAt,
          // Keep enrichment that the registry cannot supply.
          website: fresh.website ?? prior.website,
          email: fresh.email ?? prior.email,
          // Without these two a rescan silently relabels a guessed address as
          // published - the distinction that exists to stop her mailing an
          // inferred address - and forgets the contact form entirely. The
          // enrichment fold in scanOutcome.ts already gets this right.
          emailConfidence: fresh.email ? fresh.emailConfidence : prior.emailConfidence,
          contactFormUrl: fresh.contactFormUrl ?? prior.contactFormUrl,
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
      // Same migration as the other two read paths (KTD6). It runs over the
      // whole file because the whole file is what gets written back, so one
      // status change persists the migration for every lead in the box.
      const leads = (await readJson<Lead[]>(leadsPath(territoryId), [])).map(normalizeLead);
      const i = leads.findIndex((l) => l.id === leadId);
      if (i < 0) return null;
      const next = { ...leads[i]!, ...patch };
      leads[i] = next;
      await fs.writeText(leadsPath(territoryId), JSON.stringify(leads, null, 2));
      return next;
    },
  };
}
