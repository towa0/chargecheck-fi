import { describe, expect, it } from 'vitest';
import { estimate } from '../../src/tariff/estimate.ts';
import { at, comp, el, expectRefusal, ok, session, tariff, total } from './helpers.ts';

describe('price components', () => {
  it('ENERGY is priced per kWh', () => {
    expect(total(tariff([el([comp('ENERGY', 0.3)])]), session(30, 50))).toBeCloseTo(9, 10);
  });

  it('TIME is priced per hour of charging', () => {
    // 30 kWh at 10 kW = 3 h at 2 €/h
    expect(total(tariff([el([comp('TIME', 2)])]), session(30, 10))).toBeCloseTo(6, 10);
  });

  it('PARKING_TIME is priced per hour plugged in without charging', () => {
    // 45 min parking at 4 €/h; charging itself has no time price
    const t = tariff([el([comp('ENERGY', 0), comp('PARKING_TIME', 4)])]);
    expect(total(t, session(10, 20, undefined, 45))).toBeCloseTo(3, 10);
  });

  it('PARKING_TIME costs nothing when there is no parking', () => {
    const t = tariff([el([comp('ENERGY', 0.2), comp('PARKING_TIME', 4)])]);
    expect(total(t, session(10, 20))).toBeCloseTo(2, 10);
  });

  it('FLAT is charged once per session', () => {
    const t = tariff([el([comp('FLAT', 1.5), comp('ENERGY', 0.2)])]);
    expect(total(t, session(10, 20))).toBeCloseTo(3.5, 10);
    // A long session crossing many breakpoints still charges FLAT once.
    expect(total(t, session(100, 3.7, at(2026, 11, 16, 6)))).toBeCloseTo(21.5, 10);
  });

  it('a FLAT 0 tariff is free', () => {
    expect(total(tariff([el([comp('FLAT', 0)])]), session(30, 11))).toBe(0);
  });

  it('lists every component in the breakdown and sums to the total', () => {
    const r = ok(estimate(tariff([el([comp('FLAT', 1), comp('ENERGY', 0.2), comp('TIME', 1)])]), session(20, 10)));
    expect(r.breakdown.map((l) => l.type)).toEqual(['FLAT', 'ENERGY', 'TIME']);
    expect(r.breakdown[1]).toMatchObject({ quantity: 20, unitPrice: 0.2 });
    expect(r.breakdown[2]?.quantity).toBeCloseTo(2, 10);
    expect(r.totalInclVat).toBeCloseTo(1 + 4 + 2, 10);
  });
});

describe('VAT', () => {
  it('adds VAT per component when taxIncluded is NO', () => {
    const t = tariff([el([comp('FLAT', 1, 1, 10), comp('ENERGY', 0.2, 1, 25.5)])], 'NO');
    // 1 * 1.10 + 30 * 0.2 * 1.255
    expect(total(t, session(30, 50))).toBeCloseTo(1.1 + 7.53, 10);
  });

  it('uses prices as given when taxIncluded is YES', () => {
    const t = tariff([el([comp('ENERGY', 0.34, 1, 25.5)])], 'YES');
    expect(total(t, session(30, 50))).toBeCloseTo(10.2, 10);
  });

  it('uses prices as given when taxIncluded is N/A', () => {
    expect(total(tariff([el([comp('ENERGY', 0.3, 1, null)])], 'N/A'), session(30, 50))).toBeCloseTo(9, 10);
  });

  it('reports unit prices including VAT', () => {
    const r = ok(estimate(tariff([el([comp('ENERGY', 0.2, 1, 25.5)])], 'NO'), session(10, 50)));
    expect(r.breakdown[0]?.unitPrice).toBeCloseTo(0.251, 10);
    expect(r.breakdown[0]?.vat).toBe(25.5);
  });

  it('refuses taxIncluded NO without a VAT rate', () => {
    expectRefusal(tariff([el([comp('ENERGY', 0.3, 1, null)])], 'NO'), session(30, 50), /no VAT rate/);
  });

  it('refuses a missing or unknown taxIncluded', () => {
    const t = tariff([el([comp('ENERGY', 0.3)])]);
    delete t.taxIncluded;
    expectRefusal(t, session(30, 50), /include tax/);
    expectRefusal(tariff([el([comp('ENERGY', 0.3)])], 'MAYBE'), session(30, 50), /include tax/);
  });
});

describe('step sizes', () => {
  it('rounds ENERGY up to the Wh step', () => {
    // 10.2 kWh with 1 kWh steps bills 11 kWh
    expect(total(tariff([el([comp('ENERGY', 0.5, 1000)])]), session(10.2, 50))).toBeCloseTo(5.5, 10);
  });

  it('does not round an exact multiple up', () => {
    expect(total(tariff([el([comp('ENERGY', 0.5, 1000)])]), session(30, 7))).toBeCloseTo(15, 10);
  });

  it('rounds TIME up to the seconds step', () => {
    // 10 kWh at 11 kW = 54.55 min; 15 min steps bill 60 min at 2 €/h
    expect(total(tariff([el([comp('TIME', 2, 900)])]), session(10, 11))).toBeCloseTo(2, 10);
    // 1 min steps bill 55 min
    expect(total(tariff([el([comp('TIME', 2, 60)])]), session(10, 11))).toBeCloseTo((55 / 60) * 2, 10);
  });

  it('rounds only the last time-based dimension when parking follows charging', () => {
    // mod_cdrs example: 21 min charging, 7 min parking, both 5 min steps. Charging billed 21 min, parking 10.
    const t = tariff([el([comp('TIME', 1, 300), comp('PARKING_TIME', 5, 300)])]);
    const r = ok(estimate(t, session(7, 20, undefined, 7)));
    expect(r.breakdown.find((l) => l.type === 'TIME')?.quantity).toBeCloseTo(21 / 60, 10);
    expect(r.breakdown.find((l) => l.type === 'PARKING_TIME')?.quantity).toBeCloseTo(10 / 60, 10);
    expect(r.totalInclVat).toBeCloseTo(21 / 60 + (10 / 60) * 5, 10);
  });

  it('notes the rounding in the assumptions', () => {
    const r = ok(estimate(tariff([el([comp('TIME', 2, 900)])]), session(10, 11)));
    expect(r.assumptions.join(' ')).toMatch(/steps of 15 min/);
  });
});

// OCPI 2.2.1 tariff_14_step_size.json, in ex-VAT euros.
const STEP_EXAMPLE = tariff([
  el([comp('TIME', 1.2, 1800, null), comp('PARKING_TIME', 1.0, 900, null)], { startTime: '00:00', endTime: '17:00' }),
  el([comp('TIME', 2.4, 900, null), comp('PARKING_TIME', 1.0, 900, null)], { startTime: '17:00', endTime: '20:00' }),
  el([comp('TIME', 2.4, 900, null)], { startTime: '20:00', endTime: '00:00' }),
]);

describe('OCPI step size examples', () => {
  // Power is arbitrary here; energy / power sets the charging time.
  it('example #1: 16:55, 10 min charging, 2 min parking costs 0.55', () => {
    expect(total(STEP_EXAMPLE, session(10 / 6, 10, at(2026, 11, 16, 16, 55), 2))).toBeCloseTo(0.55, 10);
  });

  it('example #2: 16:35, 35 min charging costs 1.30', () => {
    const r = ok(estimate(STEP_EXAMPLE, session(35 / 6, 10, at(2026, 11, 16, 16, 35))));
    expect(r.totalInclVat).toBeCloseTo(1.3, 10);
    expect(r.breakdown.map((l) => Math.round(l.quantity * 60))).toEqual([25, 20]);
  });

  it('free parking example: 19:40, 12 min charging, 20 min parking costs 0.73', () => {
    const r = ok(estimate(STEP_EXAMPLE, session(2, 10, at(2026, 11, 16, 19, 40), 20)));
    expect(r.totalInclVat).toBeCloseTo(0.73, 10);
    expect(r.assumptions.join(' ')).toMatch(/12 min of this session no parking time price/);
  });
});

describe('time-of-day restrictions', () => {
  const nightCheap = tariff([
    el([comp('ENERGY', 0.1)], { startTime: '22:00', endTime: '06:00' }),
    el([comp('ENERGY', 0.2)]),
  ]);

  it('applies a window that crosses midnight', () => {
    expect(total(nightCheap, session(20, 10, at(2026, 11, 16, 23)))).toBeCloseTo(2, 10);
    expect(total(nightCheap, session(10, 10, at(2026, 11, 17, 2)))).toBeCloseTo(1, 10);
  });

  it('splits a session at the window start', () => {
    // 21:00-22:00 day (10 kWh * 0.2), 22:00-23:00 night (10 kWh * 0.1)
    expect(total(nightCheap, session(20, 10, at(2026, 11, 16, 21)))).toBeCloseTo(3, 10);
  });

  it('splits a session at the window end', () => {
    // 05:00-06:00 night, 06:00-07:00 day
    expect(total(nightCheap, session(20, 10, at(2026, 11, 17, 5)))).toBeCloseTo(3, 10);
  });

  it('treats 00:00 as end time as the end of the day', () => {
    const t = tariff([el([comp('ENERGY', 0.1)], { startTime: '20:00', endTime: '00:00' }), el([comp('ENERGY', 0.2)])]);
    // 23:00-00:00 at 0.1, 00:00-01:00 at 0.2
    expect(total(t, session(20, 10, at(2026, 11, 16, 23)))).toBeCloseTo(3, 10);
  });

  it('accepts HH:MM:SS and 24:00:00', () => {
    const t = tariff([el([comp('TIME', 1)], { startTime: '00:00:00', endTime: '24:00:00' })]);
    expect(total(t, session(10, 10, at(2026, 11, 16, 23, 30)))).toBeCloseTo(1, 10);
  });

  it('follows the spec when windows leave a gap, and says so', () => {
    // 00:00-23:59 leaves 23:59-00:00 unpriced
    const t = tariff([el([comp('ENERGY', 0.2)], { startTime: '00:00', endTime: '23:59' })]);
    const r = ok(estimate(t, session(10, 10, at(2026, 11, 16, 23, 30))));
    expect(r.totalInclVat).toBeCloseTo((10 - 10 / 60) * 0.2, 10);
    expect(r.assumptions.join(' ')).toMatch(/1 min of this session no energy price/);
  });

  it('only startTime set means from that time until midnight', () => {
    const t = tariff([el([comp('ENERGY', 0.1)], { startTime: '18:00' }), el([comp('ENERGY', 0.2)])]);
    expect(total(t, session(10, 10, at(2026, 11, 16, 17, 30)))).toBeCloseTo(0.5 * 2 + 0.5 * 1, 10);
  });

  it('uses Helsinki time, not UTC', () => {
    // 08:30 Helsinki is 06:30 UTC in winter
    const t = tariff([el([comp('ENERGY', 0.1)], { startTime: '08:00', endTime: '09:00' }), el([comp('ENERGY', 0.2)])]);
    expect(total(t, session(5, 10, at(2026, 11, 16, 8, 30)))).toBeCloseTo(0.5, 10);
  });

  it('handles the autumn DST change', () => {
    // 25 Oct 2026 clocks go back at 04:00. 7 real hours from 00:00 end at 06:00 local, all inside the night window.
    expect(total(nightCheap, session(70, 10, at(2026, 10, 25, 0)))).toBeCloseTo(7, 10);
  });
});

describe('dayOfWeek', () => {
  const weekendCheap = tariff([
    el([comp('ENERGY', 0.1)], { dayOfWeek: ['SATURDAY', 'SUNDAY'] }),
    el([comp('ENERGY', 0.3)]),
  ]);

  it('applies on the listed days only', () => {
    expect(total(weekendCheap, session(10, 10, at(2026, 11, 21, 12)))).toBeCloseTo(1, 10);
    expect(total(weekendCheap, session(10, 10, at(2026, 11, 16, 12)))).toBeCloseTo(3, 10);
  });

  it('switches at local midnight', () => {
    // Sunday 23:00 - Monday 01:00
    expect(total(weekendCheap, session(20, 10, at(2026, 11, 22, 23)))).toBeCloseTo(4, 10);
  });

  it('uses the Helsinki weekday', () => {
    // Saturday 01:00 in Helsinki is still Friday in UTC
    expect(total(weekendCheap, session(5, 10, at(2026, 11, 21, 1)))).toBeCloseTo(0.5, 10);
  });

  it('combines with a time window as a logical AND', () => {
    const t = tariff([
      el([comp('ENERGY', 0.1)], { startTime: '22:00', endTime: '06:00', dayOfWeek: ['MONDAY'] }),
      el([comp('ENERGY', 0.3)]),
    ]);
    // Monday 23:00-00:00 cheap, Tuesday 00:00-01:00 is no longer MONDAY
    expect(total(t, session(20, 10, at(2026, 11, 16, 23)))).toBeCloseTo(4, 10);
  });

  it('refuses an unknown day', () => {
    expectRefusal(tariff([el([comp('ENERGY', 0.1)], { dayOfWeek: ['FUNDAY'] })]), session(10, 10), /Unknown day/);
  });
});

describe('duration restrictions', () => {
  it('minDuration starts a component after that many seconds', () => {
    const t = tariff([el([comp('TIME', 6)], { minDuration: 7200 }), el([comp('ENERGY', 0.3)])]);
    // 3 h session: 9 € energy + 1 h at 6 €/h
    expect(total(t, session(30, 10))).toBeCloseTo(15, 10);
    // 1.5 h session never reaches it
    expect(total(t, session(30, 20))).toBeCloseTo(9, 10);
  });

  it('maxDuration ends a component after that many seconds', () => {
    // First 30 min free, then 0.25 per kWh: 20 kWh at 20 kW = 1 h
    const t = tariff([el([comp('ENERGY', 0)], { maxDuration: 1800 }), el([comp('ENERGY', 0.25)])]);
    expect(total(t, session(20, 20))).toBeCloseTo(2.5, 10);
  });

  it('counts parking time towards session duration', () => {
    const t = tariff([
      el([comp('ENERGY', 0.2)]),
      el([comp('PARKING_TIME', 6)], { minDuration: 3600 }),
    ]);
    // 30 min charging, 60 min parking: parking billed only after the first hour, so 30 min
    expect(total(t, session(10, 20, undefined, 60))).toBeCloseTo(2 + 3, 10);
  });
});

describe('power restrictions', () => {
  // OCPI max_power example
  const bands = tariff([
    el([comp('ENERGY', 0.2)], { maxPower: 16 }),
    el([comp('ENERGY', 0.35)], { maxPower: 32 }),
    el([comp('ENERGY', 0.5)]),
  ]);

  it('picks the band for the average power', () => {
    expect(total(bands, session(10, 11))).toBeCloseTo(2, 10);
    expect(total(bands, session(10, 22))).toBeCloseTo(3.5, 10);
    expect(total(bands, session(10, 50))).toBeCloseTo(5, 10);
  });

  it('treats maxPower as exclusive and minPower as inclusive', () => {
    expect(total(bands, session(10, 16))).toBeCloseTo(3.5, 10);
    const t = tariff([el([comp('ENERGY', 0.5)], { minPower: 50 }), el([comp('ENERGY', 0.3)])]);
    expect(total(t, session(10, 50))).toBeCloseTo(5, 10);
    expect(total(t, session(10, 49))).toBeCloseTo(3, 10);
  });
});

describe('energy and date restrictions', () => {
  it('minKwh and maxKwh split by energy delivered', () => {
    const t = tariff([el([comp('ENERGY', 0.4)], { maxKwh: 10 }), el([comp('ENERGY', 0.2)])]);
    expect(total(t, session(30, 10))).toBeCloseTo(10 * 0.4 + 20 * 0.2, 10);
  });

  it('startDate is inclusive and endDate exclusive', () => {
    const t = tariff([
      el([comp('ENERGY', 0.1)], { startDate: '2026-11-17', endDate: '2026-11-18' }),
      el([comp('ENERGY', 0.3)]),
    ]);
    expect(total(t, session(10, 10, at(2026, 11, 17, 12)))).toBeCloseTo(1, 10);
    expect(total(t, session(10, 10, at(2026, 11, 18, 12)))).toBeCloseTo(3, 10);
    expect(total(t, session(10, 10, at(2026, 11, 16, 12)))).toBeCloseTo(3, 10);
  });
});

describe('first match wins', () => {
  it('uses the first matching element for a dimension', () => {
    const t = tariff([el([comp('ENERGY', 0.4)]), el([comp('ENERGY', 0.1)])]);
    expect(total(t, session(10, 10))).toBeCloseTo(4, 10);
  });

  it('looks up each dimension separately', () => {
    // TIME comes from element 1 once it matches, ENERGY always from element 2
    const t = tariff([
      el([comp('TIME', 1)], { minDuration: 3600 }),
      el([comp('ENERGY', 0.2), comp('TIME', 2)]),
    ]);
    // 2 h: energy 4, first hour TIME 2, second hour TIME 1
    expect(total(t, session(20, 10))).toBeCloseTo(7, 10);
  });

  it('falls through to a later element when the first does not match', () => {
    const t = tariff([
      el([comp('ENERGY', 0.1)], { startTime: '00:00', endTime: '06:00' }),
      el([comp('ENERGY', 0.3)]),
    ]);
    expect(total(t, session(10, 10))).toBeCloseTo(3, 10);
  });

  it('charges nothing for a dimension with no matching element', () => {
    const t = tariff([el([comp('ENERGY', 0.2)]), el([comp('TIME', 5)], { startTime: '00:00', endTime: '06:00' })]);
    expect(total(t, session(10, 10))).toBeCloseTo(2, 10);
  });
});

describe('refusals', () => {
  it('refuses CONGESTION_TIME', () => {
    const t = tariff([el([comp('CONGESTION_TIME', 30, 60)]), el([comp('ENERGY', 0.37)])]);
    expectRefusal(t, session(30, 50), /congestion fee/);
  });

  it('refuses reservation elements', () => {
    expectRefusal(
      tariff([el([comp('FLAT', 0)], { reservation: 'RESERVATION' }), el([comp('ENERGY', 0.2)])]),
      session(30, 50),
      /reservation/,
    );
  });

  it('refuses current-based restrictions', () => {
    expectRefusal(tariff([el([comp('ENERGY', 0.2)], { maxCurrent: 32 })]), session(30, 50), /current/);
    expectRefusal(tariff([el([comp('ENERGY', 0.2)], { minCurrent: 6 })]), session(30, 50), /current/);
  });

  it('refuses unknown restriction keys and component types', () => {
    expectRefusal(tariff([el([comp('ENERGY', 0.2)], { moonPhase: 'FULL' })]), session(30, 50), /moonPhase/);
    expectRefusal(tariff([el([comp('MYSTERY', 1)])]), session(30, 50), /MYSTERY/);
  });

  it('ignores restriction keys that are null or empty', () => {
    const t = tariff([el([comp('ENERGY', 0.2)], { reservation: null, minCurrent: null, dayOfWeek: [] })]);
    expect(total(t, session(10, 50))).toBeCloseTo(2, 10);
  });

  it('refuses unreadable times', () => {
    expectRefusal(tariff([el([comp('ENERGY', 0.2)], { startTime: '7am' })]), session(30, 50), /startTime/);
    expectRefusal(tariff([el([comp('ENERGY', 0.2)], { endTime: '25:00' })]), session(30, 50), /endTime/);
  });

  it('refuses min and max price, which are not applied', () => {
    expectRefusal(tariff([el([comp('ENERGY', 0.2)])], 'N/A', { minPrice: { beforeTaxes: 2 } }), session(30, 50), /minimum or maximum/);
  });

  it('refuses a tariff outside its validity dates', () => {
    const base = [el([comp('ENERGY', 0.2)])];
    expectRefusal(tariff(base, 'N/A', { startDateTime: '2026-12-01T00:00:00Z' }), session(30, 50), /not valid yet/);
    expectRefusal(tariff(base, 'N/A', { endDateTime: '2026-11-01T00:00:00Z' }), session(30, 50), /no longer valid/);
    expect(total(tariff(base, 'N/A', { startDateTime: '2026-11-01T00:00:00Z' }), session(10, 50))).toBeCloseTo(2, 10);
  });

  it('refuses two different flat fees that could both apply', () => {
    const t = tariff([el([comp('FLAT', 1)], { maxDuration: 600 }), el([comp('FLAT', 2), comp('ENERGY', 0.2)])]);
    expectRefusal(t, session(30, 50), /more than one flat fee/);
  });

  it('refuses a tariff with no elements', () => {
    expectRefusal(tariff([]), session(30, 50), /no price elements/);
  });

  it('refuses a bad session', () => {
    const t = tariff([el([comp('ENERGY', 0.2)])]);
    expectRefusal(t, session(0, 50), /Energy/);
    expectRefusal(t, session(10, 0), /power/);
    expectRefusal(t, session(10, 10, new Date(Number.NaN)), /start time/);
  });
});
