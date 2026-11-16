import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiStatus } from '../../src/data/api.ts';
import {
  STATUS_URL,
  createStatusPoller,
  fetchStatuses,
  latestModifiedAt,
  mergeStatuses,
  type FetchLike,
  type StatusMap,
  type Visibility,
} from '../../src/live/statuses.ts';

function st(evseId: string, status: string, modifiedAt: string, lastUpdatedAt = modifiedAt): ApiStatus {
  return { evseId, status, modifiedAt, lastUpdatedAt };
}

describe('mergeStatuses', () => {
  it('adds new EVSEs and replaces older records', () => {
    const a = mergeStatuses(new Map(), [st('A', 'AVAILABLE', '2026-11-16T10:00:00Z')]);
    const b = mergeStatuses(a, [st('A', 'CHARGING', '2026-11-16T10:05:00Z'), st('B', 'BLOCKED', '2026-11-16T10:01:00Z')]);
    expect(b.get('A')?.status).toBe('CHARGING');
    expect(b.get('B')?.status).toBe('BLOCKED');
  });

  it('never lets an older record overwrite a newer one', () => {
    const a = mergeStatuses(new Map(), [st('A', 'CHARGING', '2026-11-16T10:05:00Z')]);
    const b = mergeStatuses(a, [st('A', 'AVAILABLE', '2026-11-16T10:00:00Z')]);
    expect(b.get('A')?.status).toBe('CHARGING');
  });

  it('accepts a record with the same modifiedAt, so repeats are harmless', () => {
    const a = mergeStatuses(new Map(), [st('A', 'CHARGING', '2026-11-16T10:05:00Z')]);
    const b = mergeStatuses(a, [st('A', 'CHARGING', '2026-11-16T10:05:00Z', '2026-11-16T10:06:00Z')]);
    expect(b.get('A')?.lastUpdatedAt).toBe('2026-11-16T10:06:00Z');
  });

  it('returns a new map and leaves the input alone', () => {
    const a = mergeStatuses(new Map(), [st('A', 'AVAILABLE', '2026-11-16T10:00:00Z')]);
    const b = mergeStatuses(a, [st('A', 'CHARGING', '2026-11-16T10:05:00Z')]);
    expect(b).not.toBe(a);
    expect(a.get('A')?.status).toBe('AVAILABLE');
  });

  it('skips malformed records', () => {
    const bad = [{ evseId: 5, status: 'X' }, null] as unknown as ApiStatus[];
    expect(mergeStatuses(new Map(), bad).size).toBe(0);
  });
});

describe('latestModifiedAt', () => {
  it('finds the latest timestamp, or null when empty', () => {
    expect(latestModifiedAt(new Map())).toBeNull();
    const m = mergeStatuses(new Map(), [
      st('A', 'AVAILABLE', '2026-11-16T10:00:00Z'),
      st('B', 'AVAILABLE', '2026-11-16T12:00:00.123Z'),
      st('C', 'AVAILABLE', '2026-11-16T11:00:00Z'),
    ]);
    expect(latestModifiedAt(m)).toBe('2026-11-16T12:00:00.123Z');
  });
});

interface Call {
  url: URL;
  headers: Record<string, string>;
}

/** A fake fetch that serves pages and records every call. */
function fakeApi(pages: (call: Call, index: number) => { statuses: ApiStatus[]; next?: string } | 'fail') {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    const call = { url: new URL(url), headers: (init?.headers ?? {}) as Record<string, string> };
    calls.push(call);
    const page = pages(call, calls.length - 1);
    if (page === 'fail') return new Response('nope', { status: 503 });
    return new Response(JSON.stringify({ statuses: page.statuses, pagination: { nextCursor: page.next ?? null } }));
  };
  return { calls, fetchFn };
}

describe('fetchStatuses', () => {
  const noSleep = async () => {};

  it('follows cursors and sends the required headers', async () => {
    const { calls, fetchFn } = fakeApi((call) =>
      call.url.searchParams.get('cursor') === 'p2'
        ? { statuses: [st('B', 'AVAILABLE', '2026-11-16T10:00:00Z')] }
        : { statuses: [st('A', 'AVAILABLE', '2026-11-16T10:00:00Z')], next: 'p2' },
    );
    const result = await fetchStatuses(fetchFn, '2026-11-16T09:00:00Z', 0, noSleep);
    expect(result.map((s) => s.evseId)).toEqual(['A', 'B']);
    expect(calls).toHaveLength(2);
    expect(`${calls[0]?.url.origin}${calls[0]?.url.pathname}`).toBe(STATUS_URL);
    expect(calls[0]?.url.searchParams.get('limit')).toBe('500');
    expect(calls[0]?.url.searchParams.get('modifiedAfter')).toBe('2026-11-16T09:00:00Z');
    expect(calls[0]?.headers['Digitraffic-User']).toMatch(/^chargecheck-fi\/\d+\.\d+\.\d+$/);
    expect(calls[0]?.headers.Accept).toBe('application/json');
  });

  it('throws on an error response', async () => {
    const { fetchFn } = fakeApi(() => 'fail');
    await expect(fetchStatuses(fetchFn, null, 0, noSleep)).rejects.toThrow(/503/);
  });
});

function fakeVisibility(): Visibility & { set(hidden: boolean): void } {
  let hidden = false;
  const listeners = new Set<() => void>();
  return {
    isHidden: () => hidden,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    set(h) {
      hidden = h;
      for (const cb of listeners) cb();
    },
  };
}

describe('createStatusPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(fail: (index: number) => boolean = () => false) {
    let n = 0;
    const api = fakeApi((_call, index) => {
      if (fail(index)) return 'fail';
      n++;
      return { statuses: [st(`E${n}`, 'AVAILABLE', new Date(Date.now() - 1000).toISOString())] };
    });
    const visibility = fakeVisibility();
    const updates: StatusMap[] = [];
    const errors: unknown[] = [];
    const poller = createStatusPoller({
      fetch: api.fetchFn,
      visibility,
      onUpdate: (m) => updates.push(m),
      onError: (e) => errors.push(e),
      pageDelayMs: 0,
    });
    return { ...api, visibility, updates, errors, poller };
  }

  it('does a full load first, then polls changes every 60 s', async () => {
    const { calls, updates, poller } = setup();
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.searchParams.has('modifiedAfter')).toBe(false);
    expect(updates).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(59_000);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url.searchParams.get('modifiedAfter')).toBe('2026-11-16T11:59:59.000Z');
    expect(updates.at(-1)?.size).toBe(2);
    poller.stop();
  });

  it('never polls more than once per 60 s over a long run', async () => {
    const { calls, poller } = setup();
    poller.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    // t = 0, 60, ..., 600 s
    expect(calls).toHaveLength(11);
    poller.stop();
  });

  it('stops while hidden and resumes when visible', async () => {
    const { calls, visibility, poller } = setup();
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);

    visibility.set(true);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(calls).toHaveLength(1);

    // More than 60 s since the last poll, so it polls right away.
    visibility.set(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    poller.stop();
  });

  it('waits out the rest of the interval when the tab comes back quickly', async () => {
    const { calls, visibility, poller } = setup();
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    visibility.set(true);
    await vi.advanceTimersByTimeAsync(20_000);
    visibility.set(false);
    await vi.advanceTimersByTimeAsync(39_000);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(2);
    poller.stop();
  });

  it('does not start while the tab is hidden', async () => {
    const { calls, visibility, poller } = setup();
    visibility.set(true);
    poller.start();
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(calls).toHaveLength(0);
    visibility.set(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    poller.stop();
  });

  it('reports errors and retries a failed full load after the interval', async () => {
    const { calls, errors, updates, poller } = setup((i) => i === 0);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toHaveLength(1);
    expect(updates).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url.searchParams.has('modifiedAfter')).toBe(false);
    expect(updates).toHaveLength(1);
    poller.stop();
  });

  it('makes no requests after stop', async () => {
    const { calls, poller } = setup();
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    poller.stop();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(calls).toHaveLength(1);
  });
});
