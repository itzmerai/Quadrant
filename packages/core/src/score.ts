import type { Lead } from './types';
import { groupByKey } from './taxonomy';

/**
 * Call order, not lead quality in the abstract.
 *
 * The question this answers is "who should she dial first?", so the weights
 * favour reachability (can she get a human?) and warmth (is this practice
 * likely to need help right now?) over completeness of the record.
 */

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

function yearsSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / YEAR_MS;
}

export interface ScoreResult {
  score: number;
  reasons: string[];
}

export function scoreLead(lead: Lead): ScoreResult {
  let score = 0;
  const reasons: string[] = [];

  // --- Reachability: can she actually get someone on the line? ---
  if (lead.phone) {
    score += 30;
  } else {
    reasons.push('No practice phone');
  }

  if (lead.contactName) {
    score += 20;
    reasons.push('Ask for ' + lead.contactName);
  }

  // A direct line that differs from the front desk is worth more than one that
  // just repeats it.
  if (lead.contactPhone && lead.contactPhone !== lead.phone) {
    score += 15;
    reasons.push('Direct line bypasses reception');
  }

  // --- Warmth: is this practice likely to need admin help right now? ---
  const ageYears = yearsSince(lead.enumeratedAt);
  if (ageYears !== null) {
    if (ageYears < 2) {
      score += 25;
      reasons.push('New practice — likely still building its admin team');
    } else if (ageYears < 4) {
      score += 15;
      reasons.push('Practice under 4 years old');
    }
  }

  // --- Freshness: is the record worth trusting? ---
  const staleYears = yearsSince(lead.recordUpdatedAt);
  if (staleYears !== null) {
    if (staleYears < 2) {
      score += 10;
    } else if (staleYears > 5) {
      score -= 15;
      reasons.push('Registry record not updated in over 5 years — verify before calling');
    }
  }

  // --- Fit: the presets are the niches with the highest VA adoption. ---
  const group = groupByKey(lead.specialtyGroup);
  if (group?.preset) {
    score += 10;
    reasons.push(group.label + ' — strong VA fit');
  }

  // --- Research surface: nice to have, not decisive. ---
  if (lead.website) score += 5;
  if (lead.email) score += 5;

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

/** Rescore after enrichment adds a website or email. */
export function rescore(lead: Lead): Lead {
  const { score, reasons } = scoreLead(lead);
  return { ...lead, score, scoreReasons: reasons };
}

export type ScoreBand = 'hot' | 'warm' | 'cool';

export function scoreBand(score: number): ScoreBand {
  if (score >= 75) return 'hot';
  if (score >= 50) return 'warm';
  return 'cool';
}
