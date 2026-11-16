export const TIME_ZONE = 'Europe/Helsinki';

const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const offsetCache = new Map<number, number>();

/** Offset of Helsinki local time from UTC in ms at the given instant. */
export function offsetAt(ms: number): number {
  // EU clock changes happen on the hour, so one lookup per UTC hour is exact.
  const bucket = Math.floor(ms / HOUR_MS);
  const hit = offsetCache.get(bucket);
  if (hit !== undefined) return hit;
  const probe = bucket * HOUR_MS;
  const p: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(probe))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0, p.second ?? 0);
  const offset = asUtc - probe;
  offsetCache.set(bucket, offset);
  return offset;
}

export interface LocalTime {
  /** YYYY-MM-DD */
  date: string;
  weekday: (typeof DAYS)[number];
  /** Minutes since local midnight, with fractions. */
  minuteOfDay: number;
  year: number;
  month: number;
  day: number;
}

export function localTime(ms: number): LocalTime {
  const d = new Date(ms + offsetAt(ms));
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const minuteOfDay = (d.getTime() - Date.UTC(year, month - 1, day)) / 60_000;
  return {
    date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    weekday: DAYS[d.getUTCDay()] ?? 'SUNDAY',
    minuteOfDay,
    year,
    month,
    day,
  };
}

/** UTC instant for a Helsinki wall-clock time. Times skipped by a DST change map to just after the gap. */
export function zonedToUtc(year: number, month: number, day: number, minuteOfDay: number): number {
  const wall = Date.UTC(year, month - 1, day) + minuteOfDay * 60_000;
  const first = wall - offsetAt(wall);
  const second = wall - offsetAt(first);
  return second;
}

/** Parses a datetime-local style string ("2026-11-16T18:30") as Helsinki local time. */
export function parseLocalDateTime(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  return new Date(zonedToUtc(y, mo, d, h * 60 + mi));
}

/** Formats an instant as a datetime-local string in Helsinki time. */
export function toLocalInputValue(date: Date): string {
  const t = localTime(date.getTime());
  const h = Math.floor(t.minuteOfDay / 60);
  const m = Math.floor(t.minuteOfDay % 60);
  return `${t.date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
