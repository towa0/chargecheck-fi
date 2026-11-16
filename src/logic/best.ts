import type { Evse } from '../data/types.ts';
import { STANDARD_LABELS } from './format.ts';
import type { CostOption, Result } from './results.ts';
import { availabilityKind } from './status.ts';
import type { Estimate } from '../tariff/types.ts';

const DC = new Set(['IEC_62196_T2_COMBO', 'CHADEMO', 'MCS']);

export type OkOption = CostOption & { result: Extract<Estimate, { ok: true }> };

export type BestPick =
  | { kind: 'waiting' }
  | { kind: 'none'; reason: string; fix: 'fast' | 'connector' | null }
  | { kind: 'best'; result: Result; option: OkOption };

interface PickFilters {
  fastOnly: boolean;
  connector: string;
}

/** Cheapest charger with at least one free EVSE and an estimate; ties go to the nearest. */
export function pickBest(results: readonly Result[], statusesLoaded: boolean, f: PickFilters): BestPick {
  if (!statusesLoaded) return { kind: 'waiting' };
  let best: Result | null = null;
  for (const r of results) {
    if (availabilityKind(r.availability) !== 'free' || r.cost.kind !== 'estimate') continue;
    if (
      !best ||
      best.cost.kind !== 'estimate' ||
      r.cost.min < best.cost.min - 1e-9 ||
      (Math.abs(r.cost.min - best.cost.min) <= 1e-9 && r.distanceKm < best.distanceKm)
    ) {
      best = r;
    }
  }
  if (best && best.cost.kind === 'estimate' && best.cost.options[0]) {
    return { kind: 'best', result: best, option: best.cost.options[0] };
  }

  const connector = f.connector ? (STANDARD_LABELS[f.connector] ?? f.connector) : '';
  const what = [f.fastOnly ? 'fast' : '', connector].filter(Boolean).join(' ');
  const fix = f.connector ? 'connector' : f.fastOnly ? 'fast' : null;
  const hint = fix === 'connector' ? " Try 'Any connector'." : fix === 'fast' ? " Try turning off 'Fast only'." : '';
  if (results.length === 0) return { kind: 'none', reason: `No ${what ? `${what} ` : ''}chargers match.${hint}`, fix };
  const anyFree = results.some((r) => availabilityKind(r.availability) === 'free');
  if (!anyFree) return { kind: 'none', reason: `No free ${what ? `${what} ` : ''}chargers match right now.${hint}`, fix };
  return { kind: 'none', reason: 'The free chargers that match have no price in the open data.', fix: null };
}

/** "150 kW DC" for the most powerful matching EVSE. */
export function powerBadge(evses: readonly Evse[]): string | null {
  let top: Evse | null = null;
  for (const e of evses) if (e.kw !== null && (!top || e.kw > (top.kw ?? 0))) top = e;
  if (!top || top.kw === null) return null;
  const kw = Number.isInteger(top.kw) ? top.kw : top.kw.toFixed(1);
  return `${kw} kW ${top.standards.some((s) => DC.has(s)) ? 'DC' : 'AC'}`;
}

export function directionsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}

export function geoUrl(lat: number, lon: number, label: string): string {
  return `geo:${lat},${lon}?q=${lat},${lon}(${encodeURIComponent(label)})`;
}
