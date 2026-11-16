// Real tariffs from the AFIR API (Fintraffic / digitraffic.fi, CC BY 4.0), see tests/fixtures/.
// Each expected total was worked out by hand; the working is in the comment above it.
import { describe, expect, it } from 'vitest';
import { estimate } from '../../src/tariff/estimate.ts';
import type { Tariff } from '../../src/tariff/types.ts';
import fixtureFile from '../fixtures/tariffs.json' with { type: 'json' };
import { at, ok, session } from './helpers.ts';

const F = fixtureFile.tariffs as unknown as Record<string, Tariff>;

function fixture(name: string): Tariff {
  const t = F[name];
  if (!t) throw new Error(`No fixture ${name}`);
  return t;
}

// 17 Nov 2026 is a Tuesday, after every fixture's startDateTime.
const TUE = (h: number, m = 0) => at(2026, 11, 17, h, m);

function totalOf(name: string, energy: number, power: number, start: Date, parking = 0): number {
  return ok(estimate(fixture(name), session(energy, power, start, parking))).totalInclVat;
}

describe('real tariffs', () => {
  it('energy only, VAT on top', () => {
    // 30 kWh * 0.2152 * 1.255 = 8.10228
    expect(totalOf('energyOnly', 30, 50, TUE(12))).toBeCloseTo(8.10228, 9);
  });

  it('flat 0 plus energy, zero time and parking prices', () => {
    // 30 * 0.231 * 1.255 = 8.69715; FLAT, TIME and PARKING_TIME are 0
    expect(totalOf('flatEnergyZeroTime', 30, 11, TUE(12), 30)).toBeCloseTo(8.69715, 9);
  });

  it('time fee after two hours, tax included', () => {
    // 30 kWh at 11 kW = 2.7273 h. Energy 30 * 0.34 = 10.20.
    // TIME after 7200 s: 2618.2 s, 60 s steps -> 2640 s = 0.7333 h * 1.20 = 0.88. Total 11.08
    expect(totalOf('timeAfterTwoHoursTaxIncluded', 30, 11, TUE(12))).toBeCloseTo(11.08, 9);
    // 30 kWh at 50 kW = 36 min, no time fee: 10.20
    expect(totalOf('timeAfterTwoHoursTaxIncluded', 30, 50, TUE(12))).toBeCloseTo(10.2, 9);
  });

  it('time price per weekday with 00:00:00-24:00:00 windows', () => {
    // 30 kWh at 11 kW = 163.64 min -> 164 min with 60 s steps.
    // Energy 30 * 0.12 * 1.255 = 4.518. Time 164/60 * 0.012 * 1.255 = 0.041164. Total 4.559164
    expect(totalOf('timeByWeekday', 30, 11, TUE(12))).toBeCloseTo(4.559164, 9);
  });

  it('1 kWh energy steps and a parking fee', () => {
    // 10.5 kWh -> 11 kWh * 0.38 * 1.255 = 5.2459. Parking 10 min * 9.56 * 1.255 / 6 = 1.9996333. Total 7.2455333
    expect(totalOf('kwhStepsAndParking', 10.5, 50, TUE(12), 10)).toBeCloseTo(7.2455333, 6);
  });

  it('day and night prices, tax included, session crossing 21:00', () => {
    // 20:00-21:00 22 kWh * 0.28 = 6.16; 21:00-22:00 22 kWh * 0.19 = 4.18. Total 10.34
    expect(totalOf('dayNightTaxIncluded', 44, 22, TUE(20))).toBeCloseTo(10.34, 9);
  });

  it('day and night energy with a daytime idle fee after 6 h', () => {
    // 30 kWh at 3.7 kW = 8.108 h, 13:00 to 21:06.
    // Energy 13-20: 25.9 kWh * 0.1912 * 1.255 = 6.2148604; 20-21:06: 4.1 kWh * 0.1594 * 1.255 = 0.8201927.
    // TIME from 19:00 (6 h) to 20:00 (window ends): 1 h * 0.954 * 1.255 = 1.19727. Total 8.2323231
    const r = ok(estimate(fixture('dayNightWithDaytimeIdleFee'), session(30, 3.7, TUE(13))));
    expect(r.totalInclVat).toBeCloseTo(8.2323231, 6);
    expect(r.assumptions.join(' ')).toMatch(/no charging time price in the tariff applies/);
  });

  it('time and parking fee after 45 min', () => {
    // 30 kWh at 50 kW = 36 min: 30 * 0.39 * 1.255 = 14.6835
    expect(totalOf('timeFeeAfter45Min', 30, 50, TUE(12))).toBeCloseTo(14.6835, 9);
    // 30 kWh at 30 kW = 60 min: 14.6835 + 15 min of TIME * 12 * 1.255 = 3.765. Total 18.4485
    expect(totalOf('timeFeeAfter45Min', 30, 30, TUE(12))).toBeCloseTo(18.4485, 9);
    // 36 min charging + 20 min parked: parking only billed from 45 min, so 11 min * 12 * 1.255 / 60 = 2.761.
    // Total 14.6835 + 2.761 = 17.4445
    expect(totalOf('timeFeeAfter45Min', 30, 50, TUE(12), 20)).toBeCloseTo(17.4445, 9);
  });

  it('power bands with a time fee after 45 min', () => {
    // 22 kW (< 50): 20 kWh * 1.00 * 1.255 = 25.10. Session 54.55 min, TIME from 45 min: 572.7 s -> 600 s.
    // 10 min * 12 * 1.255 / 60 = 2.51. Total 27.61
    expect(totalOf('powerBands', 20, 22, TUE(12))).toBeCloseTo(27.61, 9);
    // 100 kW: 30 kWh in 18 min at 0.36: 30 * 0.36 * 1.255 = 13.554
    expect(totalOf('powerBands', 30, 100, TUE(12))).toBeCloseTo(13.554, 9);
    // Exactly 50 kW falls in the minPower 50 band: 36 min, 13.554
    expect(totalOf('powerBands', 30, 50, TUE(12))).toBeCloseTo(13.554, 9);
  });

  it('day and night energy with day and night time fees', () => {
    // 30 kWh at 11 kW from 18:00, ends 20:43.6.
    // Energy 18-20: 22 kWh * 0.2869 * 1.255 = 7.921309; 20-20:43.6: 8 kWh * 0.239 * 1.255 = 2.39956.
    // TIME 19:00-20:00 (after 1 h, day window): 1 h * 17.2112 * 1.255 = 21.600056.
    // After 20:00 the night TIME needs 12 h, so nothing. Total 31.920925
    expect(totalOf('dayNightTimeFees', 30, 11, TUE(18))).toBeCloseTo(31.920925, 9);
  });

  it('one price per weekday with 23:59 end times', () => {
    // 30 * 0.2789 * 1.255 = 10.500585
    expect(totalOf('onePricePerWeekday', 30, 50, TUE(12))).toBeCloseTo(10.500585, 9);
  });

  it('refuses a congestion fee tariff', () => {
    const r = estimate(fixture('congestionFee'), session(30, 50, TUE(12)));
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/CONGESTION_TIME/) });
  });

  it('refuses a reservation tariff', () => {
    const r = estimate(fixture('reservation'), session(30, 50, TUE(12)));
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/reservation/) });
  });
});

describe('properties over all fixtures', () => {
  const names = Object.keys(F);
  const starts = [TUE(0), TUE(6, 59), TUE(12), TUE(19, 30), TUE(23, 45), at(2026, 11, 21, 23)];
  const powers = [3.7, 11, 22, 50, 150];
  const parkings = [0, 15];

  it('more kWh never costs less with the same tariff and start', () => {
    let checked = 0;
    for (const name of names) {
      for (const start of starts) {
        for (const power of powers) {
          for (const parking of parkings) {
            let previous = -Infinity;
            for (let kwh = 1; kwh <= 80; kwh += 3) {
              const r = estimate(fixture(name), session(kwh, power, start, parking));
              if (!r.ok) continue;
              expect(r.totalInclVat).toBeGreaterThanOrEqual(previous - 1e-9);
              previous = r.totalInclVat;
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('total equals the sum of the breakdown', () => {
    for (const name of names) {
      for (const start of starts) {
        for (const power of powers) {
          const r = estimate(fixture(name), session(27.3, power, start, 20));
          if (!r.ok) continue;
          const sum = r.breakdown.reduce((s, l) => s + l.amount, 0);
          expect(r.totalInclVat).toBeCloseTo(sum, 9);
          for (const line of r.breakdown) expect(line.amount).toBeCloseTo(line.quantity * line.unitPrice, 9);
        }
      }
    }
  });
});
