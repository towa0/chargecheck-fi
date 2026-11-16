// Tariff shapes as served by the Digitraffic AFIR API: OCPI tariffs in camelCase.
// Unknown string values are kept as `string` so the engine can refuse them instead of crashing.

export type DayOfWeek =
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'
  | 'SUNDAY';

export type KnownDimension = 'ENERGY' | 'FLAT' | 'TIME' | 'PARKING_TIME';

export interface PriceComponent {
  type: string;
  price: number;
  vat?: number | null;
  stepSize: number;
}

export interface TariffRestrictions {
  startTime?: string | null;
  endTime?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  minKwh?: number | null;
  maxKwh?: number | null;
  minCurrent?: number | null;
  maxCurrent?: number | null;
  minPower?: number | null;
  maxPower?: number | null;
  minDuration?: number | null;
  maxDuration?: number | null;
  dayOfWeek?: string[] | null;
  reservation?: string | null;
  [key: string]: unknown;
}

export interface TariffElement {
  priceComponents: PriceComponent[];
  restrictions?: TariffRestrictions | null;
}

export interface PriceLimit {
  beforeTaxes?: number | null;
  afterTaxes?: number | null;
  // OCPI 2.2.1 names, in case a feed uses them.
  exclVat?: number | null;
  inclVat?: number | null;
}

export interface Tariff {
  countryCode?: string;
  partyId?: string;
  id: string;
  currency: string;
  type?: string | null;
  taxIncluded?: string | null;
  elements: TariffElement[];
  minPrice?: PriceLimit | null;
  maxPrice?: PriceLimit | null;
  startDateTime?: string | null;
  endDateTime?: string | null;
  lastUpdated?: string;
  [key: string]: unknown;
}

export interface Session {
  energyKWh: number;
  avgPowerKW: number;
  start: Date;
  parkingMinutes?: number;
}

export interface BreakdownLine {
  type: KnownDimension;
  /** kWh for ENERGY, hours for TIME and PARKING_TIME, 1 for FLAT. */
  quantity: number;
  /** Price per unit including VAT. */
  unitPrice: number;
  /** VAT percentage, or null when the tariff gives none. */
  vat: number | null;
  /** Amount including VAT. */
  amount: number;
}

export type Estimate =
  | {
      ok: true;
      totalInclVat: number;
      currency: string;
      breakdown: BreakdownLine[];
      assumptions: string[];
    }
  | { ok: false; reason: string };
