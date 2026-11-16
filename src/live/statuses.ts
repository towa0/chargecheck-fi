import type { ApiStatus } from '../data/api.ts';
import { version } from '../../package.json';

export const STATUS_URL = 'https://afir.digitraffic.fi/api/charging-network/v1/locations/statuses';
export const POLL_INTERVAL_MS = 60_000;

export interface LiveStatus {
  status: string;
  lastUpdatedAt: string;
  modifiedAt: string;
}

export type StatusMap = ReadonlyMap<string, LiveStatus>;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Returns a new map with the incoming statuses applied. Older records never overwrite newer ones. */
export function mergeStatuses(current: StatusMap, incoming: readonly ApiStatus[]): Map<string, LiveStatus> {
  const next = new Map(current);
  for (const s of incoming) {
    if (!s || typeof s.evseId !== 'string' || typeof s.status !== 'string') continue;
    const prev = next.get(s.evseId);
    if (prev && Date.parse(prev.modifiedAt) > Date.parse(s.modifiedAt)) continue;
    next.set(s.evseId, { status: s.status, lastUpdatedAt: s.lastUpdatedAt, modifiedAt: s.modifiedAt });
  }
  return next;
}

/** Latest modifiedAt in the map, used as the next modifiedAfter. */
export function latestModifiedAt(map: StatusMap): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const s of map.values()) {
    const ms = Date.parse(s.modifiedAt);
    if (ms > bestMs) {
      bestMs = ms;
      best = s.modifiedAt;
    }
  }
  return best;
}

interface StatusPage {
  statuses?: ApiStatus[];
  pagination?: { nextCursor?: string | null };
}

/** Fetches all pages of statuses, optionally only those modified after a timestamp. */
export async function fetchStatuses(
  fetchFn: FetchLike,
  modifiedAfter: string | null,
  pageDelayMs: number,
  sleep: (ms: number) => Promise<void>,
  onPage?: (pagesLoaded: number) => void,
): Promise<ApiStatus[]> {
  let pages = 0;
  const all: ApiStatus[] = [];
  let cursor: string | null | undefined;
  do {
    const params = new URLSearchParams({ limit: '500' });
    if (modifiedAfter) params.set('modifiedAfter', modifiedAfter);
    if (cursor) params.set('cursor', cursor);
    const res = await fetchFn(`${STATUS_URL}?${params.toString()}`, {
      headers: { 'Digitraffic-User': `chargecheck-fi/${version}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Status request failed: ${res.status}`);
    const page = (await res.json()) as StatusPage;
    if (Array.isArray(page.statuses)) all.push(...page.statuses);
    pages++;
    onPage?.(pages);
    const next = page.pagination?.nextCursor;
    cursor = next && next !== cursor ? next : null;
    if (cursor) await sleep(pageDelayMs);
  } while (cursor);
  return all;
}

export interface Visibility {
  isHidden(): boolean;
  subscribe(onChange: () => void): () => void;
}

export function documentVisibility(doc: Document = document): Visibility {
  return {
    isHidden: () => doc.visibilityState === 'hidden',
    subscribe(onChange) {
      doc.addEventListener('visibilitychange', onChange);
      return () => doc.removeEventListener('visibilitychange', onChange);
    },
  };
}

export interface PollerOptions {
  fetch: FetchLike;
  visibility: Visibility;
  onUpdate: (map: StatusMap) => void;
  onError?: (err: unknown) => void;
  /** Called after each page of the first full load. */
  onProgress?: (pagesLoaded: number) => void;
  intervalMs?: number;
  /** Longest wait between retries after errors. */
  maxBackoffMs?: number;
  pageDelayMs?: number;
  now?: () => number;
}

export interface StatusPoller {
  start(): void;
  stop(): void;
}

/**
 * Loads all statuses once, then fetches changes every interval while the page is visible.
 * A new request batch never starts sooner than one interval after the previous one started.
 * After errors the wait doubles (60 s, 120 s, 240 s ...) up to maxBackoffMs.
 */
export function createStatusPoller(opts: PollerOptions): StatusPoller {
  const interval = opts.intervalMs ?? POLL_INTERVAL_MS;
  const pageDelay = opts.pageDelayMs ?? 300;
  const maxBackoff = opts.maxBackoffMs ?? 10 * 60_000;
  let failures = 0;
  const now = opts.now ?? (() => Date.now());
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  let map: StatusMap = new Map();
  let loaded = false;
  let running = false;
  let inFlight = false;
  let lastStart = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;

  function clear(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule(): void {
    clear();
    if (!running || inFlight || opts.visibility.isHidden()) return;
    const delay = failures === 0 ? interval : Math.min(interval * 2 ** (failures - 1), Math.max(interval, maxBackoff));
    const wait = Math.max(0, lastStart + delay - now());
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, wait);
  }

  async function tick(): Promise<void> {
    if (!running || inFlight || opts.visibility.isHidden()) return;
    inFlight = true;
    lastStart = now();
    try {
      const since = loaded ? latestModifiedAt(map) : null;
      const statuses = await fetchStatuses(opts.fetch, since, pageDelay, sleep, loaded ? undefined : opts.onProgress);
      if (!running) return;
      map = mergeStatuses(map, statuses);
      loaded = true;
      failures = 0;
      opts.onUpdate(map);
    } catch (err) {
      failures++;
      opts.onError?.(err);
    } finally {
      inFlight = false;
      schedule();
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      unsubscribe = opts.visibility.subscribe(() => {
        if (opts.visibility.isHidden()) clear();
        else schedule();
      });
      schedule();
    },
    stop() {
      running = false;
      clear();
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
