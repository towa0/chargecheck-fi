import type { Meta, RegionFile, TariffFile } from './types.ts';

export interface DataSource {
  meta(): Promise<Meta>;
  region(id: string): Promise<RegionFile>;
  tariffs(): Promise<TariffFile>;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${path}`);
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return (await res.json()) as T;
}

export const httpDataSource: DataSource = {
  meta: () => getJson<Meta>('meta.json'),
  region: (id) => getJson<RegionFile>(`${encodeURIComponent(id)}.json`),
  tariffs: () => getJson<TariffFile>('tariffs.json'),
};
