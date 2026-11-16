import { describe, expect, it } from 'vitest';
import type { Charger, Evse } from '../../src/data/types.ts';
import { directionsUrl, geoUrl, pickBest, powerBadge } from '../../src/logic/best.ts';
import type { Availability, ChargerCost, Result } from '../../src/logic/results.ts';

const evse = (kw: number | null, standards: string[]): Evse => ({ id: 'x', kw, standards, tariffIds: [] });

function avail(free: number, total: number, busy = 0): Availability {
  const byStatus = new Map<string, number>();
  if (free) byStatus.set('AVAILABLE', free);
  if (busy) byStatus.set('CHARGING', busy);
  return { available: free, total, unknown: total - free - busy, oldestUpdate: '2026-11-16T10:00:00Z', byStatus };
}

function priced(min: number, max = min): ChargerCost {
  const option = {
    tariffId: 't',
    tariffType: null,
    powerKW: 22,
    result: { ok: true as const, totalInclVat: min, currency: 'EUR', breakdown: [], assumptions: [] },
  };
  return { kind: 'estimate', min, max, currency: 'EUR', options: [option], refused: [], someWithoutPrice: false };
}

function result(name: string, cost: ChargerCost, availability: Availability | null, distanceKm: number): Result {
  const charger: Charger = { id: name, name, address: '', lat: 65, lon: 25, operator: 'Op', open247: false, evses: [] };
  return { charger, evses: [], distanceKm, maxKw: 22, availability, cost };
}

const f = { fastOnly: false, connector: '' };

describe('pickBest', () => {
  it('waits for live statuses', () => {
    expect(pickBest([], false, f)).toEqual({ kind: 'waiting' });
  });

  it('picks the cheapest free charger, nearest on a tie', () => {
    const rs = [
      result('busy cheap', priced(2), avail(0, 2, 2), 1),
      result('free far', priced(5), avail(1, 2), 9),
      result('free near', priced(5), avail(1, 2), 3),
      result('free pricey', priced(8), avail(2, 2), 0.5),
      result('free no price', { kind: 'no-price' }, avail(1, 1), 0.1),
    ];
    const pick = pickBest(rs, true, f);
    expect(pick.kind === 'best' && pick.result.charger.name).toBe('free near');
  });

  it('explains why nothing qualifies', () => {
    expect(pickBest([], true, { fastOnly: true, connector: 'IEC_62196_T2_COMBO' })).toEqual({
      kind: 'none',
      reason: "No fast CCS chargers match. Try 'Any connector'.",
      fix: 'connector',
    });
    expect(pickBest([result('a', priced(3), avail(0, 1, 1), 1)], true, { fastOnly: true, connector: '' })).toEqual({
      kind: 'none',
      reason: "No free fast chargers match right now. Try turning off 'Fast only'.",
      fix: 'fast',
    });
    expect(pickBest([result('a', priced(3), avail(0, 1, 1), 1)], true, f)).toMatchObject({
      reason: 'No free chargers match right now.',
      fix: null,
    });
    expect(pickBest([result('a', { kind: 'no-price' }, avail(1, 1), 1)], true, f)).toMatchObject({
      reason: 'The free chargers that match have no price in the open data.',
    });
  });
});

describe('powerBadge and links', () => {
  it('labels the most powerful EVSE as AC or DC', () => {
    expect(powerBadge([evse(22, ['IEC_62196_T2']), evse(150, ['IEC_62196_T2_COMBO'])])).toBe('150 kW DC');
    expect(powerBadge([evse(7.4, ['IEC_62196_T2'])])).toBe('7.4 kW AC');
    expect(powerBadge([evse(null, ['IEC_62196_T2'])])).toBeNull();
  });

  it('builds directions links without an API', () => {
    expect(directionsUrl(65.01, 25.47)).toBe('https://www.google.com/maps/dir/?api=1&destination=65.01,25.47');
    expect(geoUrl(65.01, 25.47, 'K-Market & Co')).toBe('geo:65.01,25.47?q=65.01,25.47(K-Market%20%26%20Co)');
  });
});
