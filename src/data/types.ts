import type { Tariff } from '../tariff/types.ts';

export interface Evse {
  id: string;
  /** Highest connector power in kW, or null when unknown. */
  kw: number | null;
  /** Connector standards, like IEC_62196_T2_COMBO. */
  standards: string[];
  tariffIds: string[];
}

export interface Charger {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  operator: string;
  open247: boolean;
  evses: Evse[];
}

export interface RegionFile {
  region: string;
  chargers: Charger[];
}

export type TariffFile = Record<string, Tariff>;

export interface RegionMeta {
  label: string;
  /** [minLat, minLon, maxLat, maxLon], or null for the whole country. */
  bbox: [number, number, number, number] | null;
  chargers: number;
  evses: number;
}

export interface Meta {
  builtAt: string;
  source: string;
  license: string;
  attribution: string;
  counts: { locations: number; evses: number; evsesWithTariff: number; tariffs: number };
  regions: Record<string, RegionMeta>;
}
