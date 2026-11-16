import type { TariffFile } from '../data/types.ts';
import { cheaperStartTimes } from '../tariff/cheaper.ts';
import { localTime } from '../tariff/time.ts';
import type { Result } from './results.ts';

export interface CheaperHint {
  saving: number;
  label: string;
  currency: string;
}

export type HintCache = Map<string, CheaperHint | null>;

function clock(ms: number): string {
  const m = localTime(ms).minuteOfDay;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
}

/** "€3.10 cheaper from 22:00" for the charger's cheapest price, if a later start saves at least €0.50. */
export function cheaperHint(r: Result, tariffs: TariffFile, energyKWh: number, start: Date, cache: HintCache): CheaperHint | null {
  if (r.cost.kind !== 'estimate') return null;
  const option = r.cost.options[0];
  const tariff = option ? tariffs[option.tariffId] : undefined;
  if (!option || !tariff) return null;
  const key = `${tariff.id}|${option.powerKW}|${energyKWh}|${start.getTime()}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const result = cheaperStartTimes(tariff, { energyKWh, avgPowerKW: option.powerKW, start });
  let hint: CheaperHint | null = null;
  if (result?.best) {
    const when = result.best.start.getTime();
    const sameDay = localTime(when).date === localTime(start.getTime()).date;
    hint = {
      saving: result.best.saving,
      label: sameDay ? clock(when) : `${clock(when)} tomorrow`,
      currency: r.cost.currency,
    };
  }
  cache.set(key, hint);
  return hint;
}
