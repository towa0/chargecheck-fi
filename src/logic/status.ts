import type { Availability } from './results.ts';
import { STALE_AFTER_MS } from './format.ts';

/** free: at least one EVSE free. busy: none free, some in use. down: none usable. unknown: no live status. */
export type AvailabilityKind = 'free' | 'busy' | 'down' | 'unknown';

const BUSY = new Set(['CHARGING', 'RESERVED', 'BLOCKED']);

export function availabilityKind(a: Availability | null): AvailabilityKind {
  if (!a || a.unknown === a.total) return 'unknown';
  if (a.available > 0) return 'free';
  for (const [status, n] of a.byStatus) if (BUSY.has(status) && n > 0) return 'busy';
  return 'down';
}

export function availabilityText(a: Availability | null, kind: AvailabilityKind = availabilityKind(a)): string {
  if (!a || kind === 'unknown') return 'No live status';
  if (kind === 'free') return `${a.available} of ${a.total} free`;
  if (kind === 'busy') return a.total === 1 ? 'In use' : `All ${a.total} in use`;
  return a.total === 1 ? 'Out of order' : 'None working';
}

/** "status 3 h ago", plus whether it is older than 24 h. */
export function freshness(a: Availability | null, now: number): { text: string; stale: boolean } | null {
  if (!a?.oldestUpdate) return null;
  const ms = now - Date.parse(a.oldestUpdate);
  if (!Number.isFinite(ms)) return null;
  const min = Math.floor(ms / 60_000);
  let ago: string;
  if (min < 1) ago = 'just now';
  else if (min < 60) ago = `${min} min ago`;
  else if (min < 48 * 60) ago = `${Math.floor(min / 60)} h ago`;
  else ago = `${Math.floor(min / 1440)} days ago`;
  return { text: `status ${ago}`, stale: ms > STALE_AFTER_MS };
}
