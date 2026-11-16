// Cost estimate for one charging session under one OCPI tariff.
// Spec references are to OCPI 2.2.1 mod_tariffs / mod_cdrs, plus OCPI 2.3 for taxIncluded.
import { DAY_MS, localTime, zonedToUtc } from './time.ts';
import type {
  BreakdownLine,
  DayOfWeek,
  Estimate,
  KnownDimension,
  PriceComponent,
  Session,
  Tariff,
  TariffRestrictions,
} from './types.ts';

const DIMENSIONS: readonly KnownDimension[] = ['ENERGY', 'FLAT', 'TIME', 'PARKING_TIME'];
const WEEKDAYS: readonly DayOfWeek[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
];
const HOUR_MS = 3_600_000;
// Absorbs float noise so 30 kWh doesn't round up to the next Wh step.
const EPSILON = 1e-9;

interface Rules {
  startMin: number | null;
  endMin: number | null;
  startDate: string | null;
  endDate: string | null;
  minKwh: number | null;
  maxKwh: number | null;
  minPower: number | null;
  maxPower: number | null;
  minDuration: number | null;
  maxDuration: number | null;
  days: Set<string> | null;
}

interface Element {
  rules: Rules;
  components: Map<KnownDimension, PriceComponent>;
}

class Refusal extends Error {}

function refuse(reason: string): never {
  throw new Refusal(reason);
}

const HANDLED_KEYS = new Set([
  'startTime',
  'endTime',
  'startDate',
  'endDate',
  'minKwh',
  'maxKwh',
  'minPower',
  'maxPower',
  'minDuration',
  'maxDuration',
  'dayOfWeek',
]);

function isSet(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

/** Minutes since midnight for "HH:MM" or "HH:MM:SS". "24:00" means end of day. */
function parseTimeOfDay(value: unknown, key: string): number {
  const m = typeof value === 'string' ? /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value) : null;
  if (!m) refuse(`Unreadable ${key} "${String(value)}" in the tariff.`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = Number(m[3] ?? 0);
  if (h > 24 || min > 59 || s > 59 || (h === 24 && (min > 0 || s > 0))) {
    refuse(`Unreadable ${key} "${String(value)}" in the tariff.`);
  }
  return h * 60 + min + s / 60;
}

function num(value: unknown, key: string): number | null {
  if (!isSet(value)) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) refuse(`Unreadable ${key} in the tariff.`);
  return value;
}

function date(value: unknown, key: string): string | null {
  if (!isSet(value)) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) refuse(`Unreadable ${key} in the tariff.`);
  return value;
}

function parseRules(r: TariffRestrictions | null | undefined): Rules {
  const rules: Rules = {
    startMin: null,
    endMin: null,
    startDate: null,
    endDate: null,
    minKwh: null,
    maxKwh: null,
    minPower: null,
    maxPower: null,
    minDuration: null,
    maxDuration: null,
    days: null,
  };
  if (!r) return rules;
  for (const [key, value] of Object.entries(r)) {
    if (!isSet(value)) continue;
    if (key === 'reservation') refuse('The tariff has reservation pricing, which this tool does not estimate.');
    if (key === 'minCurrent' || key === 'maxCurrent') {
      refuse('The tariff depends on charging current, which this tool does not model.');
    }
    if (!HANDLED_KEYS.has(key)) refuse(`The tariff uses a restriction this tool does not know: ${key}.`);
  }
  if (isSet(r.startTime)) rules.startMin = parseTimeOfDay(r.startTime, 'startTime');
  if (isSet(r.endTime)) rules.endMin = parseTimeOfDay(r.endTime, 'endTime');
  rules.startDate = date(r.startDate, 'startDate');
  rules.endDate = date(r.endDate, 'endDate');
  rules.minKwh = num(r.minKwh, 'minKwh');
  rules.maxKwh = num(r.maxKwh, 'maxKwh');
  rules.minPower = num(r.minPower, 'minPower');
  rules.maxPower = num(r.maxPower, 'maxPower');
  rules.minDuration = num(r.minDuration, 'minDuration');
  rules.maxDuration = num(r.maxDuration, 'maxDuration');
  if (isSet(r.dayOfWeek)) {
    if (!Array.isArray(r.dayOfWeek)) refuse('Unreadable dayOfWeek in the tariff.');
    for (const d of r.dayOfWeek) {
      if (!WEEKDAYS.includes(d as DayOfWeek)) refuse(`Unknown day "${String(d)}" in the tariff.`);
    }
    rules.days = new Set(r.dayOfWeek);
  }
  return rules;
}

function parseElements(tariff: Tariff): Element[] {
  if (!Array.isArray(tariff.elements) || tariff.elements.length === 0) {
    refuse('The tariff has no price elements.');
  }
  return tariff.elements.map((el) => {
    const components = new Map<KnownDimension, PriceComponent>();
    for (const c of el.priceComponents ?? []) {
      if (c.type === 'CONGESTION_TIME') {
        refuse('The tariff has a congestion fee (CONGESTION_TIME), which OCPI does not define.');
      }
      if (!DIMENSIONS.includes(c.type as KnownDimension)) {
        refuse(`The tariff uses a price type this tool does not know: ${c.type}.`);
      }
      if (typeof c.price !== 'number' || !Number.isFinite(c.price)) refuse('A price in the tariff is unreadable.');
      if (!Number.isInteger(c.stepSize) || c.stepSize < 1) refuse('A step size in the tariff is unreadable.');
      if (c.vat !== null && c.vat !== undefined && (typeof c.vat !== 'number' || !Number.isFinite(c.vat))) {
        refuse('A VAT rate in the tariff is unreadable.');
      }
      if (tariff.taxIncluded === 'NO' && (c.vat === null || c.vat === undefined)) {
        // OCPI 2.3 TaxIncluded: NO means tax is added on top; without a rate we can't add it.
        refuse('The tariff says VAT is added on top but gives no VAT rate.');
      }
      // Only one component per dimension per element is meaningful; keep the first.
      const dim = c.type as KnownDimension;
      if (!components.has(dim)) components.set(dim, c);
    }
    return { rules: parseRules(el.restrictions), components };
  });
}

interface Moment {
  minuteOfDay: number;
  weekday: string;
  date: string;
  durationS: number;
  energyKWh: number;
  powerKW: number;
}

function matches(r: Rules, m: Moment): boolean {
  // mod_tariffs TariffRestrictions: all set restrictions must hold (logical AND).
  if (r.startMin !== null || r.endMin !== null) {
    const t = m.minuteOfDay;
    const s = r.startMin ?? 0;
    // "To stop at end of the day use: 00:00".
    const e = r.endMin === null || r.endMin === 0 ? 1440 : r.endMin;
    if (s < e) {
      if (t < s || t >= e) return false;
    } else if (s > e) {
      // "If end_time < start_time then the period wraps around to the next day."
      if (t < s && t >= e) return false;
    }
    // s === e: the spec doesn't say; treated as the whole day.
  }
  if (r.days && !r.days.has(m.weekday)) return false;
  if (r.startDate !== null && m.date < r.startDate) return false;
  if (r.endDate !== null && m.date >= r.endDate) return false;
  if (r.minKwh !== null && m.energyKWh < r.minKwh) return false;
  if (r.maxKwh !== null && m.energyKWh >= r.maxKwh) return false;
  if (r.minPower !== null && m.powerKW < r.minPower) return false;
  if (r.maxPower !== null && m.powerKW >= r.maxPower) return false;
  if (r.minDuration !== null && m.durationS < r.minDuration) return false;
  if (r.maxDuration !== null && m.durationS >= r.maxDuration) return false;
  return true;
}

/** Instants inside (from, to) where any restriction could switch on or off. */
function breakpoints(elements: Element[], from: number, to: number, s: Session): number[] {
  const points = new Set<number>();
  const minutes = new Set<number>([0]);
  for (const { rules: r } of elements) {
    if (r.startMin !== null) minutes.add(r.startMin % 1440);
    if (r.endMin !== null) minutes.add(r.endMin % 1440);
    for (const sec of [r.minDuration, r.maxDuration]) if (sec !== null) points.add(from + sec * 1000);
    for (const kwh of [r.minKwh, r.maxKwh]) {
      if (kwh !== null) points.add(from + (kwh / s.avgPowerKW) * HOUR_MS);
    }
  }
  const first = localTime(from);
  const days = Math.ceil((to - from) / DAY_MS) + 2;
  for (let i = -1; i < days; i++) {
    const d = new Date(Date.UTC(first.year, first.month - 1, first.day + i));
    for (const min of minutes) {
      points.add(zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), min));
    }
  }
  return [...points].filter((p) => p > from && p < to).sort((a, b) => a - b);
}

interface Period {
  dim: KnownDimension;
  component: PriceComponent;
  /** kWh for ENERGY, hours for time dimensions. */
  quantity: number;
  end: number;
}

function unitPriceInclVat(c: PriceComponent, taxIncluded: string): number {
  if (taxIncluded === 'NO') return c.price * (1 + (c.vat ?? 0) / 100);
  return c.price;
}

function formatMinutes(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function stepLabel(dim: KnownDimension, step: number): string {
  if (dim === 'ENERGY') return step >= 1000 ? `${step / 1000} kWh` : `${step} Wh`;
  if (step % 60 === 0) return formatMinutes(step / 3600);
  return `${step} s`;
}

/** Rounds the dimension's total up to the step of its last active component; the extra lands in that period (mod_cdrs step_size). */
function applyStep(periods: Period[], dim: KnownDimension, assumptions: string[]): void {
  const own = periods.filter((p) => p.dim === dim && p.quantity > 0);
  const last = own.at(-1);
  if (!last) return;
  const unitsPerQuantity = dim === 'ENERGY' ? 1000 : 3600; // Wh per kWh, seconds per hour
  const step = last.component.stepSize;
  const total = own.reduce((sum, p) => sum + p.quantity, 0) * unitsPerQuantity;
  const rounded = Math.ceil(total / step - EPSILON) * step;
  const extra = rounded - total;
  if (extra > EPSILON && step > 1) {
    last.quantity += extra / unitsPerQuantity;
    const what = dim === 'ENERGY' ? 'energy' : dim === 'TIME' ? 'charging time' : 'parking time';
    assumptions.push(`The ${what} is billed in steps of ${stepLabel(dim, step)}, so it is rounded up.`);
  }
}

export function estimate(tariff: Tariff, session: Session): Estimate {
  try {
    return run(tariff, session);
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, reason: err.message };
    throw err;
  }
}

function run(tariff: Tariff, session: Session): Estimate {
  const { energyKWh, avgPowerKW, start } = session;
  const parkingMinutes = session.parkingMinutes ?? 0;
  if (!(energyKWh > 0) || !Number.isFinite(energyKWh)) refuse('Energy must be more than 0 kWh.');
  if (!(avgPowerKW > 0) || !Number.isFinite(avgPowerKW)) refuse('Charging power must be more than 0 kW.');
  if (!(parkingMinutes >= 0) || !Number.isFinite(parkingMinutes)) refuse('Parking time cannot be negative.');
  const t0 = start.getTime();
  if (!Number.isFinite(t0)) refuse('The start time is not a valid date.');

  const taxIncluded = tariff.taxIncluded;
  if (taxIncluded !== 'YES' && taxIncluded !== 'NO' && taxIncluded !== 'N/A') {
    refuse('The tariff does not say whether its prices include tax.');
  }
  if (isSet(tariff.minPrice) || isSet(tariff.maxPrice)) {
    refuse('The tariff has a minimum or maximum price, which this tool does not apply yet.');
  }
  if (tariff.startDateTime && t0 < Date.parse(tariff.startDateTime)) refuse('The tariff is not valid yet at this start time.');
  if (tariff.endDateTime && t0 >= Date.parse(tariff.endDateTime)) refuse('The tariff is no longer valid at this start time.');

  const elements = parseElements(tariff);
  const chargeMs = (energyKWh / avgPowerKW) * HOUR_MS;
  const endMs = chargeMs + parkingMinutes * 60_000;

  // Work in ms offsets from the start; absolute epoch ms lose precision in the energy sums.
  const inner = breakpoints(elements, t0, t0 + endMs, session).map((p) => p - t0);
  if (parkingMinutes > 0) inner.push(chargeMs);
  const edges = [0, ...inner.filter((p) => p > 0 && p < endMs).sort((x, y) => x - y), endMs];
  const periods: Period[] = [];
  const unpriced = new Map<KnownDimension, number>();
  const usedDims = new Set<KnownDimension>();
  for (const el of elements) for (const d of el.components.keys()) usedDims.add(d);
  const flats = new Set<PriceComponent>();

  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i] ?? 0;
    const b = edges[i + 1] ?? 0;
    if (b <= a) continue;
    const mid = (a + b) / 2;
    const charging = mid < chargeMs;
    const local = localTime(t0 + mid);
    const moment: Moment = {
      minuteOfDay: local.minuteOfDay,
      weekday: local.weekday,
      date: local.date,
      durationS: mid / 1000,
      energyKWh: charging ? (avgPowerKW * mid) / HOUR_MS : energyKWh,
      powerKW: charging ? avgPowerKW : 0,
    };
    const hours = (b - a) / HOUR_MS;
    const amounts: Record<KnownDimension, number> = {
      ENERGY: charging ? (avgPowerKW * (b - a)) / HOUR_MS : 0,
      TIME: charging ? hours : 0,
      PARKING_TIME: charging ? 0 : hours,
      FLAT: 0,
    };

    for (const dim of DIMENSIONS) {
      // mod_tariffs Tariff object: the first element with this dimension whose restrictions match wins.
      const el = elements.find((e) => e.components.has(dim) && matches(e.rules, moment));
      const component = el?.components.get(dim);
      if (dim === 'FLAT') {
        if (component) flats.add(component);
        continue;
      }
      const quantity = amounts[dim];
      if (quantity <= 0) continue;
      if (!component) {
        // No match means no cost for this dimension, per spec.
        if (usedDims.has(dim)) unpriced.set(dim, (unpriced.get(dim) ?? 0) + hours);
        continue;
      }
      const prev = periods.findLast((p) => p.dim === dim);
      if (prev && prev.component === component && prev.end === a) {
        prev.quantity += quantity;
        prev.end = b;
      } else {
        periods.push({ dim, component, quantity, end: b });
      }
    }
  }

  if (flats.size > 1) {
    refuse('The tariff has more than one flat fee that could apply, and OCPI does not say which.');
  }

  const assumptions: string[] = [];
  applyStep(periods, 'ENERGY', assumptions);
  // mod_cdrs step_size: rounding applies once for TIME and PARKING_TIME together, on the last time-based period.
  const lastTimed = periods.filter((p) => (p.dim === 'TIME' || p.dim === 'PARKING_TIME') && p.quantity > 0).at(-1);
  if (lastTimed) applyStep(periods, lastTimed.dim, assumptions);

  const lines = new Map<PriceComponent, BreakdownLine>();
  for (const p of periods) {
    const unitPrice = unitPriceInclVat(p.component, taxIncluded);
    const line = lines.get(p.component);
    if (line) {
      line.quantity += p.quantity;
      line.amount = line.quantity * unitPrice;
    } else {
      lines.set(p.component, {
        type: p.dim,
        quantity: p.quantity,
        unitPrice,
        vat: p.component.vat ?? null,
        amount: p.quantity * unitPrice,
      });
    }
  }
  const breakdown = [...lines.values()];
  const flat = [...flats][0];
  if (flat) {
    const unitPrice = unitPriceInclVat(flat, taxIncluded);
    breakdown.unshift({ type: 'FLAT', quantity: 1, unitPrice, vat: flat.vat ?? null, amount: unitPrice });
  }

  assumptions.unshift(
    `Charging at a steady ${round(avgPowerKW)} kW for ${formatMinutes(chargeMs / HOUR_MS)}` +
      (parkingMinutes > 0 ? `, then ${formatMinutes(parkingMinutes / 60)} plugged in without charging.` : '.'),
    'Time-of-day rules use Finnish local time.',
  );
  if (taxIncluded === 'NO') assumptions.push('The tariff lists prices without VAT. VAT is added at the rate it gives.');
  if (taxIncluded === 'YES') assumptions.push('The tariff lists prices with VAT included.');
  if (taxIncluded === 'N/A') assumptions.push('The tariff says no tax applies.');
  for (const [dim, hours] of unpriced) {
    const what = dim === 'ENERGY' ? 'energy' : dim === 'TIME' ? 'charging time' : 'parking time';
    assumptions.push(
      `For ${formatMinutes(hours)} of this session no ${what} price in the tariff applies. ` +
        'OCPI counts that as free, so the real cost may be higher.',
    );
  }

  const totalInclVat = breakdown.reduce((sum, l) => sum + l.amount, 0);
  return { ok: true, totalInclVat, currency: tariff.currency, breakdown, assumptions };
}

function round(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
