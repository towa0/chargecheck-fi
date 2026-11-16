import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import pkg from '../../package.json' with { type: 'json' };

export const API_BASE = 'https://afir.digitraffic.fi/api/charging-network/v1';
export const USER_AGENT = `chargecheck-fi/${pkg.version}`;

const HEADERS = {
  'Digitraffic-User': USER_AGENT,
  Accept: 'application/json',
  'Accept-Encoding': 'gzip',
};

const PAGE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Page {
  pagination?: { nextCursor?: string | null; limit?: number };
  [key: string]: unknown;
}

export async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}/${path}`, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/** Follows pagination.nextCursor until it runs out and returns all items under `key`. */
export async function fetchAllPages(endpoint: string, key: string): Promise<unknown[]> {
  const items: unknown[] = [];
  let cursor: string | null | undefined;
  let pages = 0;
  do {
    const params = new URLSearchParams({ limit: '500' });
    if (cursor) params.set('cursor', cursor);
    const page = (await getJson(`${endpoint}?${params.toString()}`)) as Page;
    const chunk = page[key];
    if (!Array.isArray(chunk)) {
      throw new Error(`${endpoint}: expected array at "${key}", got ${typeof chunk}`);
    }
    items.push(...chunk);
    pages += 1;
    const next = page.pagination?.nextCursor;
    // Guard against a cursor that repeats, which would loop forever.
    if (next && next === cursor) throw new Error(`${endpoint}: cursor did not advance`);
    cursor = next;
    if (cursor) await sleep(PAGE_DELAY_MS);
  } while (cursor);
  process.stdout.write(`  ${endpoint}: ${items.length} items in ${pages} pages\n`);
  return items;
}

export async function writeJson(path: string, data: unknown, pretty = false): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, pretty ? 2 : undefined));
}

export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}
