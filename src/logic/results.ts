import type { Charger, Evse, TariffFile } from '../data/types.ts';
import type { StatusMap } from '../live/statuses.ts';
import { estimate } from '../tariff/estimate.ts';
import type { Estimate, Tariff } from '../tariff/types.ts';

export const FAST_KW = 50;
// Average session power the estimate assumes: the charger's power, capped at what a typical car takes.
export const AC_CAR_LIMIT_KW = 11;
export const DC_CAR_LIMIT_KW = 100;
export const UNKNOWN_POWER_KW = 11;

const DC_STANDARDS = new Set(['IEC_62196_T2_COMBO', 'CHADEMO', 'MCS']);

export type SortKey = 'cost' | 'distance' | 'power';

export interface Filters {
  energyKWh: number;
  fastOnly: boolean;
  /** Connector standard, or '' for any. */
  connector: string;
  start: Date;
  sort: SortKey;
}

export interface Point {
  lat: number;
  lon: number;
}

export interface CostOption {
  tariffId: string;
  tariffType: string | null;
  powerKW: number;
  result: Estimate;
}

export type ChargerCost =
  | { kind: 'no-price' }
  | { kind: 'refused'; reason: string }
  | {
      kind: 'estimate';
      min: number;
      max: number;
      currency: string;
      options: (CostOption & { result: Extract<Estimate, { ok: true }> })[];
      refused: (CostOption & { result: Extract<Estimate, { ok: false }> })[];
      someWithoutPrice: boolean;
    };

export interface Availability {
  available: number;
  total: number;
  /** EVSEs with no live status record. */
  unknown: number;
  /** Oldest lastUpdatedAt among EVSEs with a status. */
  oldestUpdate: string | null;
  /** EVSE count per status value. */
  byStatus: Map<string, number>;
}

export interface Result {
  charger: Charger;
  evses: Evse[];
  distanceKm: number;
  maxKw: number | null;
  availability: Availability | null;
  cost: ChargerCost;
}

export function distanceKm(a: Point, b: Point): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function evseMatches(e: Evse, f: Pick<Filters, 'fastOnly' | 'connector'>): boolean {
  if (f.fastOnly && (e.kw === null || e.kw < FAST_KW)) return false;
  if (f.connector && !e.standards.includes(f.connector)) return false;
  return true;
}

/** The steady power the estimate assumes for this EVSE. */
export function sessionPower(e: Evse, connector: string): number {
  const dc = connector ? DC_STANDARDS.has(connector) : e.standards.some((s) => DC_STANDARDS.has(s));
  const cap = dc ? DC_CAR_LIMIT_KW : AC_CAR_LIMIT_KW;
  if (e.kw === null) return UNKNOWN_POWER_KW;
  return Math.min(e.kw, cap);
}

export function isValidAt(t: Tariff, at: Date): boolean {
  const ms = at.getTime();
  if (t.startDateTime && ms < Date.parse(t.startDateTime)) return false;
  if (t.endDateTime && ms >= Date.parse(t.endDateTime)) return false;
  return true;
}

export type EstimateCache = Map<string, Estimate>;

function costFor(evses: Evse[], tariffs: TariffFile, f: Filters, cache: EstimateCache): ChargerCost {
  const options: CostOption[] = [];
  const seen = new Set<string>();
  let withoutPrice = 0;
  for (const e of evses) {
    const all = e.tariffIds.map((id) => tariffs[id]).filter((t): t is Tariff => Boolean(t));
    if (all.length === 0) {
      withoutPrice++;
      continue;
    }
    // Connectors often list old tariff versions too; only use the ones valid at the start time.
    const valid = all.filter((t) => isValidAt(t, f.start));
    const use = valid.length > 0 ? valid : all;
    const power = sessionPower(e, f.connector);
    for (const t of use) {
      const key = `${t.id}|${power}|${f.energyKWh}|${f.start.getTime()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let result = cache.get(key);
      if (!result) {
        result = estimate(t, { energyKWh: f.energyKWh, avgPowerKW: power, start: f.start });
        cache.set(key, result);
      }
      options.push({ tariffId: t.id, tariffType: t.type ?? null, powerKW: power, result });
    }
  }
  if (options.length === 0) return { kind: 'no-price' };
  const ok = options.filter((o): o is CostOption & { result: Extract<Estimate, { ok: true }> } => o.result.ok);
  const refused = options.filter((o): o is CostOption & { result: Extract<Estimate, { ok: false }> } => !o.result.ok);
  if (ok.length === 0) return { kind: 'refused', reason: refused[0]?.result.reason ?? 'Unknown reason.' };
  ok.sort((a, b) => a.result.totalInclVat - b.result.totalInclVat);
  const totals = ok.map((o) => o.result.totalInclVat);
  return {
    kind: 'estimate',
    min: Math.min(...totals),
    max: Math.max(...totals),
    currency: ok[0]?.result.currency ?? 'EUR',
    options: ok,
    refused,
    someWithoutPrice: withoutPrice > 0,
  };
}

function availabilityFor(evses: Evse[], statuses: StatusMap | null): Availability | null {
  if (!statuses) return null;
  let available = 0;
  let unknown = 0;
  let oldest: string | null = null;
  const byStatus = new Map<string, number>();
  for (const e of evses) {
    const s = statuses.get(e.id);
    if (!s) {
      unknown++;
      continue;
    }
    if (s.status === 'AVAILABLE') available++;
    byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1);
    if (oldest === null || Date.parse(s.lastUpdatedAt) < Date.parse(oldest)) oldest = s.lastUpdatedAt;
  }
  return { available, total: evses.length, unknown, oldestUpdate: oldest, byStatus };
}

function sortValue(r: Result): number {
  return r.cost.kind === 'estimate' ? r.cost.min : Infinity;
}

export function buildResults(
  chargers: readonly Charger[],
  tariffs: TariffFile,
  statuses: StatusMap | null,
  filters: Filters,
  point: Point,
  cache: EstimateCache = new Map(),
): Result[] {
  const results: Result[] = [];
  for (const charger of chargers) {
    const evses = charger.evses.filter((e) => evseMatches(e, filters));
    if (evses.length === 0) continue;
    const powers = evses.map((e) => e.kw).filter((k): k is number => k !== null);
    results.push({
      charger,
      evses,
      distanceKm: distanceKm(point, charger),
      maxKw: powers.length > 0 ? Math.max(...powers) : null,
      availability: availabilityFor(evses, statuses),
      cost: costFor(evses, tariffs, filters, cache),
    });
  }
  const byDistance = (a: Result, b: Result) => a.distanceKm - b.distanceKm;
  if (filters.sort === 'distance') results.sort(byDistance);
  if (filters.sort === 'power') results.sort((a, b) => (b.maxKw ?? -1) - (a.maxKw ?? -1) || byDistance(a, b));
  if (filters.sort === 'cost') {
    results.sort((a, b) => {
      const d = sortValue(a) - sortValue(b);
      return Number.isNaN(d) || d === 0 ? byDistance(a, b) : d;
    });
  }
  return results;
}
