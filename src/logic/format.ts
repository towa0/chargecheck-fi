import type { BreakdownLine } from '../tariff/types.ts';

const money = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: number, currency = 'EUR'): string {
  let f = money.get(currency);
  if (!f) {
    f = new Intl.NumberFormat('en-IE', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    money.set(currency, f);
  }
  return f.format(amount);
}

/** Unit prices can be fractions of a cent, so show up to four decimals. */
export function formatUnitPrice(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

export function formatPower(kw: number | null): string {
  if (kw === null) return 'Power unknown';
  return `${Number.isInteger(kw) ? kw : kw.toFixed(1)} kW`;
}

export function formatDuration(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export const STALE_AFTER_MS = 24 * 3_600_000;

/** "updated 3 h ago" style label from an ISO timestamp. */
export function formatAge(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return 'update time unknown';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'updated just now';
  if (min < 60) return `updated ${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `updated ${h} h ago`;
  return `updated ${Math.floor(h / 24)} days ago`;
}

export function isStale(iso: string, now: number): boolean {
  return now - Date.parse(iso) > STALE_AFTER_MS;
}

export const LINE_LABELS: Record<BreakdownLine['type'], string> = {
  ENERGY: 'Energy',
  TIME: 'Charging time',
  PARKING_TIME: 'Parking time',
  FLAT: 'Session fee',
};

export function formatQuantity(line: BreakdownLine): string {
  if (line.type === 'ENERGY') return `${line.quantity.toFixed(line.quantity < 10 ? 2 : 1)} kWh`;
  if (line.type === 'FLAT') return '1';
  return formatDuration(line.quantity);
}

export function formatUnit(line: BreakdownLine, currency: string): string {
  const p = formatUnitPrice(line.unitPrice, currency);
  if (line.type === 'ENERGY') return `${p} / kWh`;
  if (line.type === 'FLAT') return p;
  return `${p} / h`;
}

export const STANDARD_LABELS: Record<string, string> = {
  IEC_62196_T2: 'Type 2',
  IEC_62196_T2_COMBO: 'CCS',
  CHADEMO: 'CHAdeMO',
  DOMESTIC_F: 'Schuko',
  MCS: 'MCS',
};

export function standardLabel(s: string): string {
  return STANDARD_LABELS[s] ?? s;
}

export function tariffTypeLabel(type: string | null | undefined): string | null {
  if (type === 'AD_HOC_PAYMENT') return 'pay at the charger';
  if (type === 'REGULAR') return 'with an app or charging card';
  if (type === 'PROFILE_CHEAP' || type === 'PROFILE_FAST' || type === 'PROFILE_GREEN') return 'with a charging profile';
  return null;
}
