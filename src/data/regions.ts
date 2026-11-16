export interface Region {
  id: string;
  label: string;
  /** [minLat, minLon, maxLat, maxLon], or null for the whole country. */
  bbox: [number, number, number, number] | null;
}

export const REGIONS: readonly Region[] = [
  { id: 'oulu', label: 'Oulu', bbox: [64.85, 25.2, 65.15, 25.9] },
  { id: 'finland', label: 'Finland', bbox: null },
];

/** Oulu city centre (Rotuaari). */
export const DEFAULT_POINT = { lat: 65.0121, lon: 25.4682 };

export function inBbox(lat: number, lon: number, bbox: Region['bbox']): boolean {
  if (!bbox) return true;
  const [minLat, minLon, maxLat, maxLon] = bbox;
  return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
}
