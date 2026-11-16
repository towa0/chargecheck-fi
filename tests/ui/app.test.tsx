import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App.tsx';
import type { DataSource } from '../../src/data/source.ts';
import type { Charger, Meta, TariffFile } from '../../src/data/types.ts';
import type { ApiStatus } from '../../src/data/api.ts';
import type { FetchLike, Visibility } from '../../src/live/statuses.ts';

const NOW = Date.parse('2026-11-16T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const tariffs: TariffFile = {
  cheap: {
    id: 'cheap',
    currency: 'EUR',
    taxIncluded: 'NO',
    elements: [{ priceComponents: [{ type: 'ENERGY', price: 0.2, vat: 25.5, stepSize: 1 }] }],
  },
  fast: {
    id: 'fast',
    currency: 'EUR',
    taxIncluded: 'YES',
    elements: [{ priceComponents: [{ type: 'ENERGY', price: 0.4, vat: 25.5, stepSize: 1 }] }],
  },
  congestion: {
    id: 'congestion',
    currency: 'EUR',
    taxIncluded: 'NO',
    elements: [
      { priceComponents: [{ type: 'CONGESTION_TIME', price: 30, stepSize: 60 }] },
      { priceComponents: [{ type: 'ENERGY', price: 0.3, vat: 25.5, stepSize: 1 }] },
    ],
  },
};

function charger(id: string, name: string, lat: number, evses: Charger['evses']): Charger {
  return { id, name, address: `${name} street 1, 90100 Oulu`, lat, lon: 25.4682, operator: `Operator ${id}`, open247: false, evses };
}

// Distances from Oulu centre grow with latitude offset.
const chargers: Charger[] = [
  charger('a', 'Alpha AC', 65.02, [
    { id: 'A1', kw: 22, standards: ['IEC_62196_T2'], tariffIds: ['cheap'] },
    { id: 'A2', kw: 22, standards: ['IEC_62196_T2'], tariffIds: ['cheap'] },
  ]),
  charger('b', 'Bravo DC', 65.05, [{ id: 'B1', kw: 150, standards: ['IEC_62196_T2_COMBO'], tariffIds: ['fast'] }]),
  charger('c', 'Charlie no price', 65.013, [{ id: 'C1', kw: 11, standards: ['IEC_62196_T2'], tariffIds: [] }]),
  charger('d', 'Delta congestion', 65.1, [{ id: 'D1', kw: 250, standards: ['IEC_62196_T2_COMBO'], tariffIds: ['congestion'] }]),
];

const meta: Meta = {
  builtAt: '2026-11-16T03:17:00Z',
  source: 'test',
  license: 'CC BY 4.0',
  attribution: 'Data: Fintraffic / digitraffic.fi, CC BY 4.0',
  counts: { locations: 4, evses: 5, evsesWithTariff: 4, tariffs: 3 },
  regions: {
    oulu: { label: 'Oulu', bbox: [64.85, 25.2, 65.15, 25.9], chargers: 4, evses: 5 },
    finland: { label: 'Finland', bbox: null, chargers: 4, evses: 5 },
  },
};

const data: DataSource = {
  meta: async () => meta,
  tariffs: async () => tariffs,
  region: async (id) => ({ region: id, chargers }),
};

function statusesFetch(list: () => ApiStatus[]): FetchLike & { calls: number } {
  const fn = (async () => {
    fn.calls++;
    return new Response(JSON.stringify({ statuses: list(), pagination: { nextCursor: null } }));
  }) as unknown as FetchLike & { calls: number };
  fn.calls = 0;
  return fn;
}

const visible: Visibility = { isHidden: () => false, subscribe: () => () => {} };

const baseStatuses = (): ApiStatus[] => [
  { evseId: 'A1', status: 'AVAILABLE', modifiedAt: hoursAgo(3), lastUpdatedAt: hoursAgo(3) },
  { evseId: 'A2', status: 'CHARGING', modifiedAt: hoursAgo(3), lastUpdatedAt: hoursAgo(3) },
  { evseId: 'B1', status: 'AVAILABLE', modifiedAt: hoursAgo(30), lastUpdatedAt: hoursAgo(30) },
];

function renderApp(statusFetch: FetchLike | null = statusesFetch(baseStatuses)) {
  return render(
    <App data={data} statusFetch={statusFetch} visibility={visible} now={() => NOW} mapView={null} announceDelayMs={50} geolocation={null} />,
  );
}

function names(): string[] {
  return within(screen.getByRole('list', { name: 'Chargers' })).getAllByRole('heading', { level: 3 }).map((h) => h.textContent ?? '');
}

function card(name: string): HTMLElement {
  return screen.getByRole('article', { name });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('App', () => {
  it('shows the three cost states', async () => {
    renderApp();
    await screen.findByText('Alpha AC');
    // 30 kWh * 0.20 * 1.255
    expect(within(card('Alpha AC')).getByText('€7.53', { selector: '.cost-value' })).toBeInTheDocument();
    expect(within(card('Alpha AC')).getByText(/Estimated cost/)).toBeInTheDocument();
    expect(within(card('Bravo DC')).getByText('€12.00', { selector: '.cost-value' })).toBeInTheDocument();
    expect(within(card('Charlie no price')).getByText('Price not in the open data')).toBeInTheDocument();
    expect(within(card('Delta congestion')).getByText(/Can't estimate: .*CONGESTION_TIME/)).toBeInTheDocument();
  });

  it('sorts by estimated cost, then distance and power', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Alpha AC');
    // Chargers without an estimate go last, nearest first.
    expect(names()).toEqual(['Alpha AC', 'Bravo DC', 'Charlie no price', 'Delta congestion']);
    await user.selectOptions(screen.getByLabelText('Sort by'), 'distance');
    expect(names()).toEqual(['Charlie no price', 'Alpha AC', 'Bravo DC', 'Delta congestion']);
    await user.selectOptions(screen.getByLabelText('Sort by'), 'power');
    expect(names()).toEqual(['Delta congestion', 'Bravo DC', 'Alpha AC', 'Charlie no price']);
  });

  it('filters fast chargers and connector types', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Alpha AC');
    await user.click(screen.getByLabelText('Fast chargers only (50 kW or more)'));
    expect(names()).toEqual(['Bravo DC', 'Delta congestion']);
    await user.click(screen.getByLabelText('Fast chargers only (50 kW or more)'));
    await user.selectOptions(screen.getByLabelText('Connector'), 'IEC_62196_T2');
    expect(names()).toEqual(['Alpha AC', 'Charlie no price']);
  });

  it('recomputes the estimate when energy changes and flags bad input', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Alpha AC');
    const energy = screen.getByLabelText('Energy to add (kWh)');
    await user.clear(energy);
    await user.type(energy, '10');
    // 10 * 0.20 * 1.255
    expect(within(card('Alpha AC')).getByText('€2.51', { selector: '.cost-value' })).toBeInTheDocument();
    await user.clear(energy);
    expect(screen.getByText('Enter a number from 1 to 200.')).toBeInTheDocument();
    expect(energy).toHaveAttribute('aria-invalid', 'true');
    // Keeps the last valid estimate.
    expect(within(card('Alpha AC')).getByText('€2.51', { selector: '.cost-value' })).toBeInTheDocument();
  });

  it('shows live availability with its age and flags stale statuses', async () => {
    renderApp();
    await screen.findByText('Alpha AC');
    const alpha = card('Alpha AC');
    await waitFor(() => expect(within(alpha).getByText('1 of 2 available')).toBeInTheDocument());
    expect(alpha).toHaveTextContent('1 in use');
    expect(alpha).toHaveTextContent('updated 3 h ago');
    expect(alpha).not.toHaveTextContent('status may be outdated');
    const bravo = card('Bravo DC');
    expect(bravo).toHaveTextContent('updated 30 h ago');
    expect(bravo).toHaveTextContent('status may be outdated');
    expect(card('Charlie no price')).toHaveTextContent('1 with no live status');
  });

  it('shows a loading state before statuses arrive', async () => {
    renderApp(null);
    await screen.findByText('Alpha AC');
    expect(within(card('Alpha AC')).getByText('Checking live status…')).toBeInTheDocument();
  });

  it('expands the cost breakdown', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Alpha AC');
    const alpha = card('Alpha AC');
    await user.click(within(alpha).getByText('Cost breakdown'));
    const table = within(alpha).getByRole('table');
    expect(within(table).getByRole('rowheader', { name: 'Energy' })).toBeInTheDocument();
    expect(table).toHaveTextContent('30.0 kWh × €0.251 / kWh (VAT 25.5%)');
    expect(alpha).toHaveTextContent('Charging at a steady 11 kW');
  });

  it('shows attribution, the estimate notice and build time in the footer', async () => {
    renderApp();
    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent('Data: Fintraffic / digitraffic.fi, CC BY 4.0');
    expect(footer).toHaveTextContent('Estimates from published tariffs. Prices in apps or via roaming can differ.');
    await waitFor(() => expect(footer).toHaveTextContent('16 Nov 2026, 05:17'));
  });
});

describe('live region', () => {
  it('announces the result count once filters settle, not on every change', async () => {
    const user = userEvent.setup();
    renderApp();
    const region = screen.getByRole('status');
    await waitFor(() => expect(region).toHaveTextContent('4 chargers found in Oulu.'));

    const changes: string[] = [];
    const observer = new MutationObserver(() => changes.push(region.textContent ?? ''));
    observer.observe(region, { childList: true, subtree: true, characterData: true });

    await user.click(screen.getByLabelText('Fast chargers only (50 kW or more)'));
    await user.selectOptions(screen.getByLabelText('Connector'), 'IEC_62196_T2_COMBO');
    await waitFor(() => expect(region).toHaveTextContent('2 chargers found in Oulu.'));
    observer.disconnect();
    // Two quick changes produce one announcement.
    expect(changes).toEqual(['2 chargers found in Oulu.']);
  });

  it('stays quiet when live statuses update', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let round = 0;
    const fetchFn = statusesFetch(() => {
      round++;
      return round === 1
        ? baseStatuses()
        : [{ evseId: 'A2', status: 'AVAILABLE', modifiedAt: hoursAgo(0), lastUpdatedAt: hoursAgo(0) }];
    });
    renderApp(fetchFn);
    const region = screen.getByRole('status');
    await waitFor(() => expect(region).toHaveTextContent('4 chargers found in Oulu.'));
    await waitFor(() => expect(card('Alpha AC')).toHaveTextContent('1 of 2 available'));

    const changes: string[] = [];
    const observer = new MutationObserver(() => changes.push(region.textContent ?? ''));
    observer.observe(region, { childList: true, subtree: true, characterData: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await waitFor(() => expect(card('Alpha AC')).toHaveTextContent('2 of 2 available'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    observer.disconnect();
    expect(fetchFn.calls).toBe(2);
    expect(changes).toEqual([]);
  });
});

describe('accessibility', () => {
  it('has no axe violations', async () => {
    const user = userEvent.setup();
    const { container } = renderApp();
    await screen.findByText('Alpha AC');
    await waitFor(() => expect(card('Alpha AC')).toHaveTextContent('1 of 2 available'));
    await user.click(within(card('Alpha AC')).getByText('Cost breakdown'));
    // jsdom has no layout or computed colours, so contrast is checked by hand instead (see src/styles.css).
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
});
