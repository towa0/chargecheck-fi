// Fetches every page of the AFIR endpoints into .cache/ and prints what the data looks like.
// Usage: npm run probe            (fetch fresh)
//        npm run probe -- --cached (reuse .cache/ from the last run)
import { existsSync } from 'node:fs';
import { fetchAllPages, getJson, readJson, writeJson } from './lib/digitraffic.ts';
import type { ApiLocationFeature, ApiOperator, ApiStatus } from '../src/data/api.ts';
import type { Tariff } from '../src/tariff/types.ts';
import { estimate } from '../src/tariff/estimate.ts';

const CACHE = '.cache';

async function load(): Promise<{
  locations: ApiLocationFeature[];
  statuses: ApiStatus[];
  tariffs: Tariff[];
  operators: ApiOperator[];
}> {
  const cached = process.argv.includes('--cached') && existsSync(`${CACHE}/tariffs.json`);
  if (cached) {
    console.log('Using cached data in .cache/');
    return {
      locations: (await readJson(`${CACHE}/locations.json`)) as ApiLocationFeature[],
      statuses: (await readJson(`${CACHE}/statuses.json`)) as ApiStatus[],
      tariffs: (await readJson(`${CACHE}/tariffs.json`)) as Tariff[],
      operators: (await readJson(`${CACHE}/operators.json`)) as ApiOperator[],
    };
  }
  console.log('Fetching from the API');
  const locations = (await fetchAllPages('locations', 'features')) as ApiLocationFeature[];
  const statuses = (await fetchAllPages('locations/statuses', 'statuses')) as ApiStatus[];
  const tariffs = (await fetchAllPages('tariffs', 'tariffs')) as Tariff[];
  const operators = (await getJson('operators')) as ApiOperator[];
  await writeJson(`${CACHE}/locations.json`, locations);
  await writeJson(`${CACHE}/statuses.json`, statuses);
  await writeJson(`${CACHE}/tariffs.json`, tariffs);
  await writeJson(`${CACHE}/operators.json`, operators);
  await writeJson(`${CACHE}/fetched-at.json`, { fetchedAt: new Date().toISOString() });
  return { locations, statuses, tariffs, operators };
}

function count<K>(map: Map<K, number>, key: K, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function show(title: string, map: Map<string, number>): void {
  console.log(`\n${title}`);
  for (const [k, v] of [...map.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }
}

function pct(part: number, whole: number): string {
  return whole === 0 ? '0' : ((100 * part) / whole).toFixed(1);
}

/** A short signature describing the structure of a tariff, used to pick varied examples. */
function shape(t: Tariff): string {
  return t.elements
    .map((e) => {
      const comps = e.priceComponents.map((c) => c.type).join('+');
      const keys = Object.entries(e.restrictions ?? {})
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k]) => k)
        .sort()
        .join(',');
      return keys ? `${comps}[${keys}]` : comps;
    })
    .join(' | ');
}

async function main(): Promise<void> {
  const { locations, statuses, tariffs, operators } = await load();
  const tariffById = new Map(tariffs.map((t) => [t.id, t]));

  let evses = 0;
  let evsesWithRef = 0;
  let evsesResolvable = 0;
  let connectors = 0;
  const tariffIdsPerConnector = new Map<string, number>();
  const missingIds = new Set<string>();
  const referenced = new Set<string>();
  const standards = new Map<string, number>();
  const powerTypes = new Map<string, number>();
  let noGeometry = 0;
  let twentyFourSeven = 0;

  for (const f of locations) {
    if (!f.geometry) noGeometry++;
    if (f.properties.openingTimes?.twentyFourSeven) twentyFourSeven++;
    for (const evse of f.properties.evses ?? []) {
      evses++;
      let hasRef = false;
      let resolvable = false;
      for (const c of evse.connectors ?? []) {
        connectors++;
        count(standards, c.standard ?? '(none)');
        count(powerTypes, c.powerType ?? '(none)');
        const ids = c.tariffIds ?? [];
        count(tariffIdsPerConnector, String(ids.length));
        for (const id of ids) {
          hasRef = true;
          referenced.add(id);
          if (tariffById.has(id)) resolvable = true;
          else missingIds.add(id);
        }
      }
      if (hasRef) evsesWithRef++;
      if (resolvable) evsesResolvable++;
    }
  }

  console.log('\nCounts');
  console.log(`  locations: ${locations.length} (no geometry: ${noGeometry}, 24/7: ${twentyFourSeven})`);
  console.log(`  evses: ${evses}`);
  console.log(`  connectors: ${connectors}`);
  console.log(`  statuses: ${statuses.length}`);
  console.log(`  tariffs: ${tariffs.length}`);
  console.log(`  operators: ${operators.length}`);
  console.log('\nTariff references (EVSE has a tariff if any of its connectors does)');
  console.log(`  EVSEs with a tariff reference: ${evsesWithRef} (${pct(evsesWithRef, evses)}%)`);
  console.log(`  EVSEs with a resolvable tariff: ${evsesResolvable} (${pct(evsesResolvable, evses)}%)`);
  console.log(
    `  EVSEs without a resolvable tariff: ${evses - evsesResolvable} (${pct(evses - evsesResolvable, evses)}%)`,
  );
  console.log(`  distinct tariff ids referenced: ${referenced.size}, not found in /tariffs: ${missingIds.size}`);
  console.log(`  tariffs not referenced by any connector: ${tariffs.filter((t) => !referenced.has(t.id)).length}`);
  show('tariffIds per connector', tariffIdsPerConnector);
  show('Connector standards', standards);
  show('Connector power types', powerTypes);

  const components = new Map<string, number>();
  const restrictionKeys = new Map<string, number>();
  const taxIncluded = new Map<string, number>();
  const tariffTypes = new Map<string, number>();
  const tariffKeys = new Map<string, number>();
  const steps = new Map<string, number>();
  const vats = new Map<string, number>();
  const currencies = new Map<string, number>();
  const shapes = new Map<string, number>();
  const reservationValues = new Map<string, number>();
  const timeValues = new Map<string, number>();
  let wrapsMidnight = 0;
  let noElements = 0;
  let withMinMax = 0;
  let withValidity = 0;

  for (const t of tariffs) {
    for (const [k, v] of Object.entries(t)) if (v !== null && v !== undefined) count(tariffKeys, k);
    count(taxIncluded, String(t.taxIncluded));
    count(tariffTypes, String(t.type));
    count(currencies, t.currency);
    count(shapes, shape(t));
    if (t.elements.length === 0) noElements++;
    if (t.minPrice || t.maxPrice) withMinMax++;
    if (t.startDateTime || t.endDateTime) withValidity++;
    for (const e of t.elements) {
      for (const c of e.priceComponents) {
        count(components, c.type);
        count(steps, `${c.type} ${c.stepSize}`);
        count(vats, `${c.vat ?? 'none'}`);
      }
      const r = e.restrictions ?? {};
      for (const [k, v] of Object.entries(r)) {
        if (v === null || v === undefined) continue;
        if (Array.isArray(v) && v.length === 0) continue;
        count(restrictionKeys, k);
        if (k === 'reservation') count(reservationValues, String(v));
        if (k === 'startTime' || k === 'endTime') count(timeValues, `${k}=${String(v)}`);
      }
      if (r.startTime && r.endTime && r.endTime < r.startTime) wrapsMidnight++;
    }
  }

  show('Top-level tariff keys (non-null)', tariffKeys);
  show('taxIncluded values', taxIncluded);
  show('Tariff type values', tariffTypes);
  show('Currencies', currencies);
  show('Price component types (count of components)', components);
  show('Restriction keys (count of elements using them)', restrictionKeys);
  show('reservation values', reservationValues);
  show('Step sizes seen (type size: count)', steps);
  show('VAT values', vats);
  show('startTime/endTime values', timeValues);
  console.log(`\n  elements with a window that wraps midnight: ${wrapsMidnight}`);
  console.log(`  tariffs with no elements: ${noElements}`);
  console.log(`  tariffs with minPrice/maxPrice: ${withMinMax}`);
  console.log(`  tariffs with startDateTime/endDateTime: ${withValidity}`);
  show('Tariff shapes (elements separated by |)', shapes);

  const statusValues = new Map<string, number>();
  const ages = new Map<string, number>();
  const now = Date.now();
  for (const s of statuses) {
    count(statusValues, s.status);
    const h = (now - Date.parse(s.lastUpdatedAt)) / 3_600_000;
    count(ages, h < 1 ? '< 1 h' : h < 24 ? '1-24 h' : h < 24 * 7 ? '1-7 days' : '> 7 days');
  }
  show('Status values', statusValues);
  show('Status age from lastUpdatedAt', ages);

  // Run the engine on every tariff for a typical session, now, to see what it refuses.
  const start = new Date();
  const refusals = new Map<string, number>();
  const refusedIds = new Set<string>();
  for (const t of tariffs) {
    const r = estimate(t, { energyKWh: 30, avgPowerKW: 22, start });
    if (!r.ok) {
      count(refusals, r.reason);
      refusedIds.add(t.id);
    }
  }
  show('Engine refusals (30 kWh at 22 kW, starting now)', refusals);
  let evsesAllRefused = 0;
  for (const f of locations) {
    for (const evse of f.properties.evses ?? []) {
      const ids = (evse.connectors ?? []).flatMap((c) => c.tariffIds ?? []).filter((id) => tariffById.has(id));
      if (ids.length > 0 && ids.every((id) => refusedIds.has(id))) evsesAllRefused++;
    }
  }
  console.log(`  tariffs refused: ${refusedIds.size} of ${tariffs.length}`);
  console.log(`  EVSEs with tariffs where every tariff is refused: ${evsesAllRefused}`);

  // Three examples with clearly different structures.
  const picks: Tariff[] = [];
  const wanted = [
    (t: Tariff) => shape(t) === 'ENERGY',
    (t: Tariff) => shape(t).includes('startTime'),
    (t: Tariff) => shape(t).includes('FLAT') && shape(t).includes('PARKING_TIME'),
    (t: Tariff) => shape(t).includes('FLAT'),
    (t: Tariff) => shape(t).includes('TIME'),
  ];
  for (const test of wanted) {
    const hit = tariffs.find((t) => test(t) && !picks.includes(t) && referenced.has(t.id));
    if (hit && picks.length < 3) picks.push(hit);
  }
  console.log('\nExample tariffs');
  for (const t of picks) console.log(JSON.stringify(t, null, 2));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
