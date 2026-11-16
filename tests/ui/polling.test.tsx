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
