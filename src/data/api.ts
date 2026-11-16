// Raw shapes from the Digitraffic AFIR API, limited to the fields this project reads.

export interface ApiConnector {
  powerType?: string;
  standard?: string;
  format?: string;
  maxVoltage?: number | null;
  maxAmperage?: number | null;
  maxElectricPower?: number | null;
  tariffIds?: string[] | null;
}

export interface ApiEvse {
  id: string;
  connectors?: ApiConnector[] | null;
}

export interface ApiLocationProperties {
  id: string;
  name?: string | null;
  openingTimes?: { twentyFourSeven?: boolean | null } | null;
  operator?: { id?: string; details?: { name?: string | null } | null } | null;
  address?: { street?: string | null; city?: string | null; postalCode?: string | null } | null;
  evses?: ApiEvse[] | null;
  [key: string]: unknown;
}

export interface ApiLocationFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] } | null;
  properties: ApiLocationProperties;
}

export interface ApiStatus {
  evseId: string;
  status: string;
  modifiedAt: string;
  lastUpdatedAt: string;
}

export interface ApiOperator {
  id: string;
  details?: { name?: string | null } | null;
}
