import { describe, expect, it } from 'vitest';
import { candidateStarts, cheaperStartTimes } from '../../src/tariff/cheaper.ts';
import type { Tariff } from '../../src/tariff/types.ts';
import fixtureFile from '../fixtures/tariffs.json' with { type: 'json' };
import { at, comp, el, session, tariff } from './helpers.ts';

const F = fixtureFile.tariffs as unknown as Record<string, Tariff>;

describe('candidateStarts', () => {
  it('lists the next startTime boundaries within 24 h, earliest first', () => {
    const t = tariff([
      el([comp('ENERGY', 0.28)], { startTime: '07:00', endTime: '21:00' }),
      el([comp('ENERGY', 0.19)], { startTime: '21:00', endTime: '07:00' }),
    ]);
    const c = candidateStarts(t, at(2026, 11, 17, 18));
    expect(c.map((d) => d.getTime())).toEqual([at(2026, 11, 17, 21).getTime(), at(2026, 11, 18, 7).getTime()]);
  });

  it('crosses midnight into the next day', () => {
    const t = tariff([el([comp('ENERGY', 0.1)], { startTime: '00:00', endTime: '06:00' }), el([comp('ENERGY', 0.3)])]);
    expect(candidateStarts(t, at(2026, 11, 16, 20)).map((d) => d.getTime())).toEqual([at(2026, 11, 17, 0).getTime()]);
  });

  it('ignores the current minute, stays within the horizon and caps the count', () => {
    const t = tariff(
      ['01:00', '04:00', '08:00', '12:00', '16:00'].map((s, i) => el([comp('ENERGY', 0.1 * (i + 1))], { startTime: s })),
    );
    const c = candidateStarts(t, at(2026, 11, 16, 4), 24, 3);
    expect(c.map((d) => d.getTime())).toEqual([at(2026, 11, 16, 8), at(2026, 11, 16, 12), at(2026, 11, 16, 16)].map((d) => d.getTime()));
    expect(candidateStarts(t, at(2026, 11, 16, 4), 3)).toHaveLength(0);
  });

  it('reads HH:MM:SS and 24:00:00', () => {
    const t = tariff([el([comp('ENERGY', 0.1)], { startTime: '24:00:00' })]);
    expect(candidateStarts(t, at(2026, 11, 16, 20))[0]?.getTime()).toBe(at(2026, 11, 17, 0).getTime());
  });

  it('returns nothing for a tariff without time windows', () => {
    expect(candidateStarts(tariff([el([comp('ENERGY', 0.3)])]), at(2026, 11, 16, 12))).toEqual([]);
  });
});

describe('cheaperStartTimes', () => {
  it('finds the night price for a real day/night tariff', () => {
    // 30 kWh at 11 kW from 18:00: all at 0.28 = 8.40. From 21:00: all at 0.19 = 5.70. Saving 2.70.
    const r = cheaperStartTimes(F.dayNightTaxIncluded!, session(30, 11, at(2026, 11, 17, 18)));
    expect(r?.baseTotal).toBeCloseTo(8.4, 9);
    expect(r?.options).toHaveLength(1);
    expect(r?.best?.start.getTime()).toBe(at(2026, 11, 17, 21).getTime());
    expect(r?.best?.totalInclVat).toBeCloseTo(5.7, 9);
    expect(r?.best?.saving).toBeCloseTo(2.7, 9);
  });

  it('finds a cheaper start after midnight', () => {
    const t = tariff([el([comp('ENERGY', 0.1)], { startTime: '00:00', endTime: '06:00' }), el([comp('ENERGY', 0.3)])]);
    // 20 kWh at 10 kW from 20:00 costs 6.00; from 00:00 it costs 2.00.
    const r = cheaperStartTimes(t, session(20, 10, at(2026, 11, 16, 20)));
    expect(r?.best?.start.getTime()).toBe(at(2026, 11, 17, 0).getTime());
    expect(r?.best?.saving).toBeCloseTo(4, 9);
  });

  it('reports no cheaper time when the session is already in the cheap window', () => {
    const r = cheaperStartTimes(F.dayNightTaxIncluded!, session(30, 11, at(2026, 11, 17, 21, 30)));
    expect(r?.options).toEqual([]);
    expect(r?.best).toBeNull();
  });

  it('reports no cheaper time for a flat price', () => {
    const r = cheaperStartTimes(F.energyOnly!, session(30, 50, at(2026, 11, 17, 12)));
    expect(r).toEqual({ baseTotal: expect.closeTo(8.10228, 6), options: [], best: null });
  });

  it('needs at least the minimum saving, inclusive', () => {
    const t = tariff([el([comp('ENERGY', 0.25)], { startTime: '22:00', endTime: '06:00' }), el([comp('ENERGY', 0.3)])]);
    // 10 kWh: 3.00 vs 2.50, saving exactly 0.50
    expect(cheaperStartTimes(t, session(10, 10, at(2026, 11, 16, 12)))?.best?.saving).toBeCloseTo(0.5, 9);
    // 8 kWh: saving 0.40, below the minimum
    expect(cheaperStartTimes(t, session(8, 10, at(2026, 11, 16, 12)))?.best).toBeNull();
  });

  it('picks the biggest saving among several candidates', () => {
    const t = tariff([
      el([comp('ENERGY', 0.2)], { startTime: '18:00', endTime: '22:00' }),
      el([comp('ENERGY', 0.1)], { startTime: '22:00', endTime: '06:00' }),
      el([comp('ENERGY', 0.4)]),
    ]);
    const r = cheaperStartTimes(t, session(10, 10, at(2026, 11, 16, 12)));
    expect(r?.options.map((o) => o.saving.toFixed(2))).toEqual(['2.00', '3.00']);
    expect(r?.best?.start.getTime()).toBe(at(2026, 11, 16, 22).getTime());
  });

  it('returns null when the tariff cannot be estimated', () => {
    expect(cheaperStartTimes(F.congestionFee!, session(30, 50, at(2026, 11, 17, 12)))).toBeNull();
  });
});
