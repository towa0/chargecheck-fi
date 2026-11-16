// Builds the compact data files the app loads from public/data/.
// Usage: npm run data             (fetch fresh)
//        npm run data -- --cached  (reuse .cache/ from the last probe)
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { fetchAllPages, readJson, writeJson } from './lib/digitraffic.ts';
import type { ApiLocationFeature } from '../src/data/api.ts';
import type { Charger, Evse, Meta, RegionFile, TariffFile } from '../src/data/types.ts';
import { REGIONS, inBbox } from '../src/data/regions.ts';
import { validateMeta, validateRegion, validateTariffs } from '../src/data/validate.ts';
import type { Tariff } from '../src/tariff/types.ts';

const OUT = 'public/data';
// Gzipped size budgets in bytes.
const BUDGETS: Record<string, number> = { 'oulu.json': 150 * 1024, 'finland.json': 1.5 * 1024 * 1024 };

async function load(): Promise<{ locations: ApiLocationFeature[]; tariffs: Tariff[] }> {
  if (process.argv.includes('--cached') && existsSync('.cache/locations.json')) {
    console.log('Using cached data in .cache/');
    return {
      locations: (await readJson('.cache/locations.json')) as ApiLocationFeature[],
      tariffs: (await readJson('.cache/tariffs.json')) as Tariff[],
    };
  }
  console.log('Fetching from the API');
  const locations = (await fetchAllPages('locations', 'features')) as ApiLocationFeature[];
  const tariffs = (await fetchAllPages('tariffs', 'tariffs')) as Tariff[];
  return { locations, tariffs };
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function slimTariff(t: Tariff): Tariff {
  const out: Tariff = { id: t.id, currency: t.currency, taxIncluded: t.taxIncluded ?? null, elements: t.elements };
  if (t.type) out.type = t.type;
  if (t.minPrice) out.minPrice = t.minPrice;
  if (t.maxPrice) out.maxPrice = t.maxPrice;
  if (t.startDateTime) out.startDateTime = t.startDateTime;
  if (t.endDateTime) out.endDateTime = t.endDateTime;
  // Drop null restriction values to save space; the engine treats missing and null the same.
  out.elements = t.elements.map((el) => {
    const r = el.restrictions
      ? Object.fromEntries(Object.entries(el.restrictions).filter(([, v]) => v !== null && v !== undefined))
      : null;
    return r && Object.keys(r).length > 0 ? { priceComponents: el.priceComponents, restrictions: r } : { priceComponents: el.priceComponents };
  });
  return out;
}

function toCharger(f: ApiLocationFeature, known: Set<string>): Charger | null {
  const p = f.properties;
  if (!f.geometry) return null;
  const [lon, lat] = f.geometry.coordinates;
  const evses: Evse[] = [];
  const seen = new Set<string>();
  for (const e of p.evses ?? []) {
    // One EVSE appears twice in the same location in the feed.
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const connectors = e.connectors ?? [];
    const watts = connectors.map((c) => c.maxElectricPower ?? 0).filter((w) => w > 0);
    const tariffIds = [...new Set(connectors.flatMap((c) => c.tariffIds ?? []))].filter((id) => known.has(id));
    evses.push({
      id: e.id,
      kw: watts.length > 0 ? round(Math.max(...watts) / 1000, 1) : null,
      standards: [...new Set(connectors.map((c) => c.standard).filter((s): s is string => Boolean(s)))],
      tariffIds,
    });
  }
  if (evses.length === 0) return null;
  const a = p.address;
  const street = a?.street?.trim() ?? '';
  const city = [a?.postalCode, a?.city].filter(Boolean).join(' ');
  return {
    // Location ids are only unique per operator.
    id: `${p.operator?.id ?? '?'}/${p.id}`,
    name: p.name?.trim() || street || 'Unnamed charger',
    address: [street, city].filter(Boolean).join(', '),
    lat: round(lat, 5),
    lon: round(lon, 5),
    operator: p.operator?.details?.name?.trim() || p.operator?.id || 'Unknown operator',
    open247: p.openingTimes?.twentyFourSeven === true,
    evses,
  };
}

async function main(): Promise<void> {
  const { locations, tariffs } = await load();
  const tariffById = new Map(tariffs.map((t) => [t.id, t]));
  const known = new Set(tariffById.keys());

  const chargers = locations.map((f) => toCharger(f, known)).filter((c): c is Charger => c !== null);
  chargers.sort((a, b) => a.id.localeCompare(b.id));

  const referenced = new Set(chargers.flatMap((c) => c.evses.flatMap((e) => e.tariffIds)));
  const tariffFile: TariffFile = {};
  for (const id of [...referenced].sort()) {
    const t = tariffById.get(id);
    if (t) tariffFile[id] = slimTariff(t);
  }

  const problems: string[] = [...validateTariffs(tariffFile)];
  const regionMeta: Meta['regions'] = {};
  const files = new Map<string, unknown>();
  for (const region of REGIONS) {
    const list = chargers.filter((c) => inBbox(c.lat, c.lon, region.bbox));
    const file: RegionFile = { region: region.id, chargers: list };
    problems.push(...validateRegion(file, referenced).map((e) => `${region.id}: ${e}`));
    if (list.length === 0) problems.push(`${region.id}: no chargers`);
    files.set(`${region.id}.json`, file);
    regionMeta[region.id] = {
      label: region.label,
      bbox: region.bbox,
      chargers: list.length,
      evses: list.reduce((n, c) => n + c.evses.length, 0),
    };
  }

  const evses = chargers.flatMap((c) => c.evses);
  const meta: Meta = {
    builtAt: new Date().toISOString(),
    source: 'https://afir.digitraffic.fi/api/charging-network/v1/',
    license: 'CC BY 4.0',
    attribution: 'Data: Fintraffic / digitraffic.fi, CC BY 4.0',
    counts: {
      locations: chargers.length,
      evses: evses.length,
      evsesWithTariff: evses.filter((e) => e.tariffIds.length > 0).length,
      tariffs: Object.keys(tariffFile).length,
    },
    regions: regionMeta,
  };
  problems.push(...validateMeta(meta).map((e) => `meta: ${e}`));
  files.set('tariffs.json', tariffFile);
  files.set('meta.json', meta);

  if (problems.length > 0) {
    console.error(`Validation failed with ${problems.length} problems:`);
    for (const p of problems.slice(0, 30)) console.error(`  ${p}`);
    process.exit(1);
  }

  let overBudget = false;
  for (const [name, data] of files) {
    const path = `${OUT}/${name}`;
    await writeJson(path, data);
    const raw = await readFile(path);
    const gz = gzipSync(raw, { level: 9 }).length;
    const budget = BUDGETS[name];
    const flag = budget && gz > budget ? '  OVER BUDGET' : '';
    if (flag) overBudget = true;
    console.log(`  ${name}: ${(raw.length / 1024).toFixed(1)} KB, ${(gz / 1024).toFixed(1)} KB gzipped${flag}`);
  }
  console.log(`  ${meta.counts.locations} locations, ${meta.counts.evses} EVSEs, ${meta.counts.tariffs} tariffs`);
  for (const [id, r] of Object.entries(regionMeta)) console.log(`  ${id}: ${r.chargers} chargers, ${r.evses} EVSEs`);
  if (overBudget) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
