import { REGIONS } from '../data/regions.ts';
import { localTime, parseLocalDateTime, zonedToUtc } from '../tariff/time.ts';
import { STANDARD_LABELS } from './format.ts';
import type { SortKey } from './results.ts';

export const ENERGY_PRESETS = [10, 30, 50] as const;
export const ENERGY_MIN = 1;
export const ENERGY_MAX = 200;
export const TONIGHT_HOUR = 22;
const STORAGE_KEY = 'chargecheck-settings-v1';

export type TimeMode = 'now' | 'tonight' | 'custom';

export interface Settings {
  energyKWh: number;
  timeMode: TimeMode;
  /** datetime-local value in Finnish time, used when timeMode is custom. */
  customStart: string;
  connector: string;
  fastOnly: boolean;
  region: string;
  sort: SortKey;
}

export const DEFAULT_SETTINGS: Settings = {
  energyKWh: 30,
  timeMode: 'now',
  customStart: '',
  connector: '',
  fastOnly: false,
  region: 'oulu',
  sort: 'cost',
};

export function parseEnergy(value: string): number | null {
  const n = Number(value.replace(',', '.'));
  if (value.trim() === '' || !Number.isFinite(n) || n < ENERGY_MIN || n > ENERGY_MAX) return null;
  return n;
}

/** Reads saved settings, keeping only values that are still valid. */
export function loadSettings(storage: Pick<Storage, 'getItem'> | null): Settings {
  let raw: unknown = null;
  try {
    const text = storage?.getItem(STORAGE_KEY);
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  const s = { ...DEFAULT_SETTINGS };
  if (typeof raw !== 'object' || raw === null) return s;
  const r = raw as Record<string, unknown>;
  if (typeof r.energyKWh === 'number' && r.energyKWh >= ENERGY_MIN && r.energyKWh <= ENERGY_MAX) s.energyKWh = r.energyKWh;
  if (r.timeMode === 'now' || r.timeMode === 'tonight' || r.timeMode === 'custom') s.timeMode = r.timeMode;
  if (typeof r.customStart === 'string' && parseLocalDateTime(r.customStart)) s.customStart = r.customStart;
  if (s.timeMode === 'custom' && !s.customStart) s.timeMode = 'now';
  if (typeof r.connector === 'string' && (r.connector === '' || r.connector in STANDARD_LABELS)) s.connector = r.connector;
  if (typeof r.fastOnly === 'boolean') s.fastOnly = r.fastOnly;
  if (typeof r.region === 'string' && REGIONS.some((x) => x.id === r.region)) s.region = r.region;
  if (r.sort === 'cost' || r.sort === 'distance' || r.sort === 'power') s.sort = r.sort;
  return s;
}

export function saveSettings(storage: Pick<Storage, 'setItem'> | null, s: Settings): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Private mode or full storage: settings just won't be remembered.
  }
}

/** The next 22:00 in Finland: today if it hasn't passed, otherwise tomorrow. */
export function tonight(now: number): Date {
  const t = localTime(now);
  const today = zonedToUtc(t.year, t.month, t.day, TONIGHT_HOUR * 60);
  if (today > now) return new Date(today);
  const d = new Date(Date.UTC(t.year, t.month - 1, t.day + 1));
  return new Date(zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), TONIGHT_HOUR * 60));
}

export function resolveStart(s: Pick<Settings, 'timeMode' | 'customStart'>, now: number): Date {
  if (s.timeMode === 'tonight') return tonight(now);
  if (s.timeMode === 'custom') {
    const d = parseLocalDateTime(s.customStart);
    if (d) return d;
  }
  return new Date(Math.floor(now / 60_000) * 60_000);
}

export function timeLabel(s: Pick<Settings, 'timeMode' | 'customStart'>, now: number): string {
  if (s.timeMode === 'now') return 'Now';
  const d = resolveStart(s, now);
  const t = localTime(d.getTime());
  const hm = `${String(Math.floor(t.minuteOfDay / 60)).padStart(2, '0')}:${String(Math.floor(t.minuteOfDay % 60)).padStart(2, '0')}`;
  const today = localTime(now).date;
  if (s.timeMode === 'tonight') return t.date === today ? `Tonight ${hm}` : `Tomorrow ${hm}`;
  if (t.date === today) return `Today ${hm}`;
  return `${t.day}.${t.month}. ${hm}`;
}
