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

  it('reports errors and retries a failed full load after five minutes', async () => {
    const { calls, errors, updates, poller } = setup((i) => i === 0);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toHaveLength(1);
    expect(updates).toHaveLength(0);
    // A full load counts against the five-minute cap even when it fails.
    await vi.advanceTimersByTimeAsync(299_000);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
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

describe('poller backoff and progress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('doubles the wait after each failure and resets after a success', async () => {
    let failing = false;
    const api = fakeApi(() => (failing ? 'fail' : { statuses: [st('A', 'AVAILABLE', new Date().toISOString())] }));
    const errors: unknown[] = [];
    const poller = createStatusPoller({
      fetch: api.fetchFn,
      visibility: fakeVisibility(),
      onUpdate: () => {},
      onError: (e) => errors.push(e),
      pageDelayMs: 0,
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(0); // t=0 full load succeeds
    failing = true;
    await vi.advanceTimersByTimeAsync(60_000); // t=60 change poll fails
    await vi.advanceTimersByTimeAsync(60_000); // t=120 fails
    expect(api.calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(119_000);
    expect(api.calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1_000); // t=240 fails
    expect(api.calls).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(239_000);
    expect(api.calls).toHaveLength(4);
    failing = false;
    await vi.advanceTimersByTimeAsync(1_000); // t=480 succeeds
    expect(api.calls).toHaveLength(5);
    expect(errors).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(60_000); // back to every 60 s
    expect(api.calls).toHaveLength(6);
    expect(api.calls.slice(1).every((c) => c.url.searchParams.has('modifiedAfter'))).toBe(true);
    poller.stop();
  });

  it('caps the backoff', async () => {
    let n = 0;
    const api = fakeApi(() => (n++ === 0 ? { statuses: [st('A', 'AVAILABLE', new Date().toISOString())] } : 'fail'));
    const poller = createStatusPoller({
      fetch: api.fetchFn,
      visibility: fakeVisibility(),
      onUpdate: () => {},
      pageDelayMs: 0,
      maxBackoffMs: 120_000,
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(0); // t=0 full load succeeds
    await vi.advanceTimersByTimeAsync(60_000 + 60_000 + 120_000 + 120_000);
    // t = 0, then failing polls at 60, 120, 240, 360
    expect(api.calls).toHaveLength(5);
    poller.stop();
  });

  it('reports page progress during the first full load only', async () => {
    const api = fakeApi((call) => {
      const c = call.url.searchParams.get('cursor');
      return c === 'p3' ? { statuses: [] } : { statuses: [], next: c === 'p2' ? 'p3' : c ? 'x' : 'p2' };
    });
    const progress: number[] = [];
    const poller = createStatusPoller({
      fetch: api.fetchFn,
      visibility: fakeVisibility(),
      onUpdate: () => {},
      onProgress: (n) => progress.push(n),
      pageDelayMs: 0,
    });
    poller.start();
    // The page loop sleeps between pages, even with a zero delay.
    await vi.advanceTimersByTimeAsync(10);
    expect(progress).toEqual([1, 2, 3]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(progress).toEqual([1, 2, 3]);
    poller.stop();
  });
});

describe('page-wide safety cap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function make(fetchFn: FetchLike, onUpdate: (m: StatusMap) => void = () => {}) {
    return createStatusPoller({ fetch: fetchFn, visibility: fakeVisibility(), onUpdate, pageDelayMs: 0 });
  }

  it('shares one budget between pollers: restarts reuse the data and wait their turn', async () => {
    const api = fakeApi(() => ({ statuses: [st('A', 'AVAILABLE', new Date().toISOString())] }));
    const first = make(api.fetchFn);
    first.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.calls).toHaveLength(1);
    first.stop();
    // Many quick restarts, as a remounting app would cause.
    const updates: StatusMap[] = [];
    for (let i = 0; i < 20; i++) {
      const p = make(api.fetchFn, (m) => updates.push(m));
      p.start();
      await vi.advanceTimersByTimeAsync(100);
      p.stop();
    }
    expect(api.calls).toHaveLength(1);
    // Each restart got the loaded statuses straight away.
    expect(updates).toHaveLength(20);
    expect(updates[0]?.get('A')?.status).toBe('AVAILABLE');
    const last = make(api.fetchFn);
    last.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.calls).toHaveLength(2);
    expect(api.calls[1]?.url.searchParams.has('modifiedAfter')).toBe(true);
    last.stop();
  });

  it('never starts more than one full load per five minutes, even after failures and restarts', async () => {
    const api = fakeApi(() => 'fail');
    for (let i = 0; i < 29; i++) {
      const p = make(api.fetchFn);
      p.start();
      await vi.advanceTimersByTimeAsync(30_000);
      p.stop();
    }
    // 14.5 minutes: full loads at 0, 5 and 10 minutes only.
    expect(api.calls).toHaveLength(3);
    expect(api.calls.every((c) => !c.url.searchParams.has('modifiedAfter'))).toBe(true);
  });

  it('two pollers running at once still poll once per minute in total', async () => {
    const api = fakeApi(() => ({ statuses: [st('A', 'AVAILABLE', new Date().toISOString())] }));
    const a = make(api.fetchFn);
    const b = make(api.fetchFn);
    a.start();
    b.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    // t = 0, 60, ..., 600
    expect(api.calls).toHaveLength(11);
    a.stop();
    b.stop();
  });

  it('does not let a short interval option go below 60 s', async () => {
    const api = fakeApi(() => ({ statuses: [] }));
    const p = createStatusPoller({ fetch: api.fetchFn, visibility: fakeVisibility(), onUpdate: () => {}, pageDelayMs: 0, intervalMs: 1_000 });
    p.start();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(api.calls).toHaveLength(1);
    p.stop();
  });
});
