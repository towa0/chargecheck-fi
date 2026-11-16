import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App.tsx';
import type { DataSource } from '../../src/data/source.ts';
import type { Charger, Meta } from '../../src/data/types.ts';
import type { FetchLike } from '../../src/live/statuses.ts';

const chargers: Charger[] = [
  { id: 'a', name: 'Alpha', address: '', lat: 65.02, lon: 25.47, operator: 'Op', open247: false, evses: [{ id: 'a1', kw: 22, standards: ['IEC_62196_T2'], tariffIds: [] }] },
];
const meta: Meta = {
  builtAt: '2026-11-16T03:17:00Z',
  source: 'test',
  license: 'CC BY 4.0',
  attribution: 'Data: Fintraffic / digitraffic.fi, CC BY 4.0',
  counts: { locations: 1, evses: 1, evsesWithTariff: 0, tariffs: 0 },
  regions: { oulu: { label: 'Oulu', bbox: null, chargers: 1, evses: 1 }, finland: { label: 'Finland', bbox: null, chargers: 1, evses: 1 } },
};
const data: DataSource = { meta: async () => meta, tariffs: async () => ({}), region: async (id) => ({ region: id, chargers }) };

afterEach(() => vi.useRealTimers());

describe('status polling in the real app wiring', () => {
  it('polls once per minute with the default document visibility, even while re-rendering', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    const statusFetch: FetchLike = async () => {
      calls++;
      return new Response(
        JSON.stringify({
          statuses: [{ evseId: 'a1', status: calls % 2 ? 'AVAILABLE' : 'CHARGING', modifiedAt: new Date(Date.now() + calls).toISOString(), lastUpdatedAt: new Date().toISOString() }],
          pagination: { nextCursor: null },
        }),
      );
    };
    // No visibility prop: the app uses document visibility, as in production.
    render(<App data={data} statusFetch={statusFetch} mapView={null} geolocation={null} storage={null} announceDelayMs={10} />);
    await screen.findByRole('article', { name: 'Alpha' });
    await waitFor(() => expect(calls).toBe(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(calls).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(calls).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(calls).toBe(7);
  });
});

describe('hard cap on status requests', () => {
  it('stays within the cap while the app is mounted, re-rendered and unmounted many times', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const urls: string[] = [];
    const statusFetch: FetchLike = async (url) => {
      urls.push(url);
      return new Response(
        JSON.stringify({
          statuses: [{ evseId: 'a1', status: 'AVAILABLE', modifiedAt: new Date(Date.now()).toISOString(), lastUpdatedAt: new Date().toISOString() }],
          pagination: { nextCursor: null },
        }),
      );
    };
    const app = (n: number) => (
      <App data={data} statusFetch={statusFetch} mapView={null} geolocation={null} storage={null} announceDelayMs={10 + n} />
    );
    // 10 minutes of churn: every 20 s the app is unmounted and mounted again, and re-rendered 5 times.
    for (let i = 0; i < 30; i++) {
      const view = render(app(0));
      await screen.findByRole('article', { name: 'Alpha' });
      for (let j = 1; j <= 5; j++) view.rerender(app(j));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      view.unmount();
    }
    const full = urls.filter((u) => !u.includes('modifiedAfter'));
    // At most one batch per 60 s over 600 s (11 with the first) and one full load per 5 minutes.
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.length).toBeLessThanOrEqual(11);
    expect(full.length).toBe(1);
  });
});
