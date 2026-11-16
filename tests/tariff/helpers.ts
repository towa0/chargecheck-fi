import { expect } from 'vitest';
import { estimate } from '../../src/tariff/estimate.ts';
import { zonedToUtc } from '../../src/tariff/time.ts';
import type { Estimate, PriceComponent, Session, Tariff, TariffElement, TariffRestrictions } from '../../src/tariff/types.ts';

/** Helsinki local time. */
export function at(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(zonedToUtc(year, month, day, hour * 60 + minute));
}

// 16 Nov 2026 is a Monday.
export const MONDAY_NOON = at(2026, 11, 16, 12);

export function comp(type: string, price: number, stepSize = 1, vat: number | null = 25.5): PriceComponent {
  return vat === null ? { type, price, stepSize } : { type, price, stepSize, vat };
}

export function el(components: PriceComponent[], restrictions?: TariffRestrictions): TariffElement {
  return restrictions ? { priceComponents: components, restrictions } : { priceComponents: components };
}

export function tariff(elements: TariffElement[], taxIncluded = 'N/A', extra: Partial<Tariff> = {}): Tariff {
  return { id: 'test', currency: 'EUR', taxIncluded, elements, ...extra };
}

export function session(energyKWh: number, avgPowerKW: number, start = MONDAY_NOON, parkingMinutes = 0): Session {
  return { energyKWh, avgPowerKW, start, parkingMinutes };
}

export function total(t: Tariff, s: Session): number {
  const r = estimate(t, s);
  if (!r.ok) throw new Error(`Expected an estimate, got refusal: ${r.reason}`);
  return r.totalInclVat;
}

export function ok(r: Estimate): Extract<Estimate, { ok: true }> {
  if (!r.ok) throw new Error(`Expected an estimate, got refusal: ${r.reason}`);
  return r;
}

export function expectRefusal(t: Tariff, s: Session, match: RegExp): void {
  const r = estimate(t, s);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toMatch(match);
}
