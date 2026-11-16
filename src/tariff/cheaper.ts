// Re-runs an estimate at later start times where the tariff's own time windows begin.
import { estimate } from './estimate.ts';
import { localTime, zonedToUtc } from './time.ts';
import type { Session, Tariff } from './types.ts';

export interface CheaperStart {
  start: Date;
  totalInclVat: number;
  saving: number;
}

export interface CheaperResult {
  baseTotal: number;
  /** Later starts that save at least minSaving, earliest first. */
  options: CheaperStart[];
  /** The option with the largest saving (earliest on a tie), or null. */
  best: CheaperStart | null;
}

export interface CheaperOptions {
  minSaving?: number;
  horizonHours?: number;
  maxCandidates?: number;
}

function minuteOf(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return (h * 60 + min) % 1440;
}

/** The next start-time boundaries from the tariff's restrictions, after `from` and within the horizon. */
export function candidateStarts(tariff: Tariff, from: Date, horizonHours = 24, max = 3): Date[] {
  const minutes = new Set<number>();
  for (const el of tariff.elements ?? []) {
    const m = minuteOf(el.restrictions?.startTime);
    if (m !== null) minutes.add(m);
  }
  if (minutes.size === 0) return [];
  const t0 = from.getTime();
  const end = t0 + horizonHours * 3_600_000;
  const first = localTime(t0);
  const days = Math.ceil(horizonHours / 24) + 1;
  const found = new Set<number>();
  for (let i = 0; i <= days; i++) {
    const d = new Date(Date.UTC(first.year, first.month - 1, first.day + i));
    for (const min of minutes) {
      const at = zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), min);
      if (at > t0 && at <= end) found.add(at);
    }
  }
  return [...found]
    .sort((a, b) => a - b)
    .slice(0, max)
    .map((ms) => new Date(ms));
}

/** Same session at the next few tariff boundaries. Returns null if the session itself can't be estimated. */
export function cheaperStartTimes(tariff: Tariff, session: Session, opts: CheaperOptions = {}): CheaperResult | null {
  const { minSaving = 0.5, horizonHours = 24, maxCandidates = 3 } = opts;
  const base = estimate(tariff, session);
  if (!base.ok) return null;
  const options: CheaperStart[] = [];
  for (const start of candidateStarts(tariff, session.start, horizonHours, maxCandidates)) {
    const r = estimate(tariff, { ...session, start });
    if (!r.ok) continue;
    const saving = base.totalInclVat - r.totalInclVat;
    // Small epsilon so a saving of exactly minSaving isn't lost to float noise.
    if (saving >= minSaving - 1e-9) options.push({ start, totalInclVat: r.totalInclVat, saving });
  }
  let best: CheaperStart | null = null;
  for (const o of options) if (!best || o.saving > best.saving + 1e-9) best = o;
  return { baseTotal: base.totalInclVat, options, best };
}

