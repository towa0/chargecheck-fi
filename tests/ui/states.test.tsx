import { act, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App.tsx';
import type { DataSource } from '../../src/data/source.ts';
import type { Charger, Meta, TariffFile } from '../../src/data/types.ts';
import type { FetchLike, Visibility } from '../../src/live/statuses.ts';

const NOW = Date.parse('2026-11-16T12:00:00Z');
const tariffs: TariffFile = {
  t: { id: 't', currency: 'EUR', taxIncluded: 'YES', elements: [{ priceComponents: [{ type: 'ENERGY', price: 0.3, stepSize: 1 }] }] },
};
const chargers: Charger[] = [
  { id: 'a', name: 'Alpha', address: '', lat: 65.02, lon: 25.47, operator: 'Op', open247: false, evses: [{ id: 'a1', kw: 22, standards: ['IEC_62196_T2'], tariffIds: ['t'] }] },
];
const meta: Meta = {
  builtAt: '2026-11-16T03:17:00Z',
  source: 'test',
  license: 'CC BY 4.0',
  attribution: 'Data: Fintraffic / digitraffic.fi, CC BY 4.0',
  counts: { locations: 1200, evses: 1, evsesWithTariff: 1, tariffs: 1 },
  regions: { oulu: { label: 'Oulu', bbox: null, chargers: 1, evses: 1 }, finland: { label: 'Finland', bbox: null, chargers: 1, evses: 1 } },
};
const visible: Visibility = { isHidden: () => false, subscribe: () => () => {} };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function renderApp(data: DataSource, statusFetch: FetchLike) {
  return render(
    <App lang="en" data={data} statusFetch={statusFetch} visibility={visible} now={() => NOW} mapView={null} announceDelayMs={10} geolocation={null} storage={null} />,
  );
}

afterEach(() => vi.useRealTimers());

describe('loading states', () => {
  it('shows skeletons until charger data arrives', async () => {
    const region = deferred<{ region: string; chargers: Charger[] }>();
    const data: DataSource = { meta: async () => meta, tariffs: async () => tariffs, region: () => region.promise };
    const { container } = renderApp(data, () => new Promise<Response>(() => {}));
    expect(screen.getByText('Loading chargers')).toBeInTheDocument();
    expect(container.querySelectorAll('.hero-skeleton, .row-skeleton')).toHaveLength(5);
    await act(async () => region.resolve({ region: 'oulu', chargers }));
    expect(await screen.findByRole('article', { name: 'Alpha' })).toBeInTheDocument();
    expect(container.querySelectorAll('.row-skeleton')).toHaveLength(0);
  });

  it('shows prices before live availability, with skeletons for the status and the best pick', async () => {
    const pages = [deferred<Response>(), deferred<Response>(), deferred<Response>()];
    let call = 0;
    const statusFetch: FetchLike = () => pages[call++]!.promise;
    const data: DataSource = { meta: async () => meta, tariffs: async () => tariffs, region: async (id) => ({ region: id, chargers }) };
    const { container } = renderApp(data, statusFetch);
    const card = await screen.findByRole('article', { name: 'Alpha' });
    expect(within(card).getByText('9,00 €', { selector: '.row-price-value' })).toBeInTheDocument();
    expect(within(card).getByText('Checking status')).toBeInTheDocument();
    expect(container.querySelector('.hero-skeleton')).not.toBeNull();
    await act(async () => pages[0]!.resolve(new Response(JSON.stringify({ statuses: [], pagination: { nextCursor: 'c2' } }))));
    await act(async () => pages[1]!.resolve(new Response(JSON.stringify({ statuses: [], pagination: { nextCursor: 'c3' } }))));
    await act(async () =>
      pages[2]!.resolve(
        new Response(
          JSON.stringify({
            statuses: [{ evseId: 'a1', status: 'AVAILABLE', modifiedAt: '2026-11-16T11:00:00Z', lastUpdatedAt: '2026-11-16T11:00:00Z' }],
            pagination: { nextCursor: null },
          }),
        ),
      ),
    );
    await waitFor(() => expect(card).toHaveTextContent('Free'));
    expect(within(card).queryByText('Checking status')).not.toBeInTheDocument();
    expect(container.querySelector('.hero-skeleton')).toBeNull();
  });
});

describe('status API failure', () => {
  it('keeps prices, says availability is unavailable and retries later', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    const failing: FetchLike = async () => {
      calls++;
      return new Response('down', { status: 503 });
    };
    const data: DataSource = { meta: async () => meta, tariffs: async () => tariffs, region: async (id) => ({ region: id, chargers }) };
    renderApp(data, failing);
    const card = await screen.findByRole('article', { name: 'Alpha' });
    await waitFor(() => expect(screen.getByText(/Live availability unavailable\. Retrying in the background\./)).toBeInTheDocument());
    expect(within(card).getByText('9,00 €', { selector: '.row-price-value' })).toBeInTheDocument();
    expect(card).toHaveTextContent('No live status');
    expect(screen.getByRole('region', { name: 'Best right now' })).toHaveTextContent("can't tell which chargers are free");
    expect(calls).toBe(1);
    // A failed full load is retried after five minutes, not sooner.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299_000);
    });
    expect(calls).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(calls).toBe(2);
  });
});
