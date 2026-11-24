import { localTime } from '../tariff/time.ts';
import type { BreakdownLine } from '../tariff/types.ts';
import type { Lang, Strings } from './strings.ts';

// Both languages format numbers the Finnish way: decimal comma, euro sign after the amount.
const LOCALE = 'fi-FI';

const cache = new Map<string, Intl.NumberFormat>();
function nf(key: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, opts);
    cache.set(key, f);
  }
  return f;
}

export interface Fmt {
  lang: Lang;
  /** Amount in euros. Zero reads as Free. */
  money(amount: number, currency?: string): string;
  /** Like money, but zero stays "0,00 €". For breakdown lines. */
  moneyExact(amount: number, currency?: string): string;
  unitPrice(amount: number, currency?: string): string;
  /** Range or single price for a charger. */
  priceRange(min: number, max: number, currency?: string): string;
  /** Whole-euro price for a map pin. */
  pin(amount: number): string;
  distance(km: number): string;
  power(kw: number | null): string;
  kwh(n: number): string;
  duration(hours: number): string;
  clock(ms: number): string;
}

export function makeFmt(lang: Lang, t: Strings): Fmt {
  const exact = (amount: number, currency = 'EUR') =>
    nf(`m|${currency}`, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  const money = (amount: number, currency = 'EUR') => (Math.abs(amount) < 0.005 ? t.card.free : exact(amount, currency));
  return {
    lang,
    money,
    moneyExact: exact,
    unitPrice: (amount, currency = 'EUR') =>
      nf(`u|${currency}`, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(amount),
    priceRange(min, max, currency = 'EUR') {
      if (Math.abs(max - min) < 0.005) return money(min, currency);
      if (Math.abs(min) < 0.005) return `${t.card.free}–${exact(max, currency)}`;
      const lo = nf('n2', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(min);
      return `${lo}–${exact(max, currency)}`;
    },
    pin(amount) {
      if (Math.abs(amount) < 0.005) return t.card.freeShort;
      return `${nf('n0', { maximumFractionDigits: 0 }).format(Math.round(amount))} €`;
    },
    distance(km) {
      if (km < 1) return `${Math.round(km * 1000)} m`;
      if (km < 10) return `${nf('d1', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(km)} km`;
      return `${Math.round(km)} km`;
    },
    power(kw) {
      if (kw === null) return lang === 'fi' ? 'Teho ei tiedossa' : 'Power unknown';
      return `${nf('p1', { maximumFractionDigits: 1 }).format(kw)} kW`;
    },
    kwh: (n) => `${nf('p1', { maximumFractionDigits: 1 }).format(n)} kWh`,
    duration(hours) {
      const total = Math.max(1, Math.round(hours * 60));
      const h = Math.floor(total / 60);
      const m = total % 60;
      if (h === 0) return `${m} min`;
      return m === 0 ? `${h} h` : `${h} h ${m} min`;
    },
    clock(ms) {
      const m = localTime(ms).minuteOfDay;
      return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
    },
  };
}

export function lineQuantity(f: Fmt, line: BreakdownLine): string {
  if (line.type === 'ENERGY') {
    const digits = line.quantity < 10 ? 2 : 1;
    return `${nf(`q${digits}`, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(line.quantity)} kWh`;
  }
  if (line.type === 'FLAT') return '1';
  return f.duration(line.quantity);
}

export function lineUnit(f: Fmt, t: Strings, line: BreakdownLine, currency: string): string {
  const p = f.unitPrice(line.unitPrice, currency);
  if (line.type === 'ENERGY') return `${p} ${t.units.perKWh}`;
  if (line.type === 'FLAT') return p;
  return `${p} ${t.units.perHour}`;
}

export function formatBuilt(lang: Lang, iso: string): string {
  return new Intl.DateTimeFormat(lang === 'fi' ? 'fi-FI' : 'en-GB', {
    timeZone: 'Europe/Helsinki',
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false,
  }).format(new Date(iso));
}
