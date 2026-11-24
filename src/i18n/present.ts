import type { Evse } from '../data/types.ts';
import { STALE_AFTER_MS } from '../logic/format.ts';
import type { Availability } from '../logic/results.ts';
import { availabilityKind, type AvailabilityKind } from '../logic/status.ts';
import { resolveStart } from '../logic/settings.ts';
import { localTime } from '../tariff/time.ts';
import type { Fmt } from './format.ts';
import type { Strings } from './strings.ts';

const DC = new Set(['IEC_62196_T2_COMBO', 'CHADEMO', 'MCS']);

export function statusLabel(t: Strings, a: Availability | null, kind: AvailabilityKind = availabilityKind(a)): string {
  if (!a || kind === 'unknown') return t.status.unknown;
  if (kind === 'free') return a.total === 1 ? t.status.free : t.status.freeOf(a.available, a.total);
  if (kind === 'busy') return a.total === 1 ? t.status.busy : t.status.busyAll(a.total);
  return a.total === 1 ? t.status.down : t.status.downAll;
}

function ago(t: Strings, ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return t.status.ago.now;
  if (min < 60) return t.status.ago.min(min);
  if (min < 48 * 60) return t.status.ago.h(Math.floor(min / 60));
  return t.status.ago.d(Math.floor(min / 1440));
}

export function freshnessText(t: Strings, a: Availability | null, now: number): { text: string; stale: boolean } | null {
  if (!a?.oldestUpdate) return null;
  const ms = now - Date.parse(a.oldestUpdate);
  if (!Number.isFinite(ms)) return null;
  return { text: t.status.updated(ago(t, ms)), stale: ms > STALE_AFTER_MS };
}

export function statusSummaryText(t: Strings, a: Availability | null): string | null {
  if (!a) return null;
  const parts = [...a.byStatus.entries()]
    .sort(([x], [y]) => (x === 'AVAILABLE' ? -1 : y === 'AVAILABLE' ? 1 : 0))
    .map(([s, n]) => `${n} ${t.status.words[s] ?? s.toLowerCase()}`);
  if (a.unknown > 0) parts.push(t.status.noLive(a.unknown));
  return parts.length > 0 ? parts.join(', ') : null;
}

/** "22 kW AC" for the highest-power matching EVSE. */
export function powerBadgeText(t: Strings, fmt: Fmt, evses: readonly Evse[]): { text: string; dc: boolean } | null {
  let top: Evse | null = null;
  for (const e of evses) if (e.kw !== null && (!top || e.kw > (top.kw ?? 0))) top = e;
  if (!top || top.kw === null) return null;
  const dc = top.standards.some((s) => DC.has(s));
  return { text: `${fmt.power(top.kw)} ${dc ? t.card.dc : t.card.ac}`, dc };
}

export function startLabel(
  t: Strings,
  fmt: Fmt,
  s: { timeMode: 'now' | 'tonight' | 'custom'; customStart: string },
  now: number,
): string {
  if (s.timeMode === 'now') return t.time.now;
  const d = resolveStart(s, now);
  const lt = localTime(d.getTime());
  const hm = fmt.clock(d.getTime());
  const today = localTime(now).date;
  if (s.timeMode === 'tonight') return lt.date === today ? t.time.tonight(hm) : t.time.tomorrow(hm);
  if (lt.date === today) return t.time.today(hm);
  return `${lt.day}.${lt.month}. ${hm}`;
}

export function tariffTypeText(t: Strings, type: string | null | undefined): string | null {
  if (type === 'AD_HOC_PAYMENT') return t.tariffType.adhoc;
  if (type === 'REGULAR') return t.tariffType.regular;
  if (type === 'PROFILE_CHEAP' || type === 'PROFILE_FAST' || type === 'PROFILE_GREEN') return t.tariffType.profile;
  return null;
}
