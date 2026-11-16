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

function renderApp(statusFetch: FetchLike | null = statusesFetch(baseStatuses), storage: Storage | null = null) {
  return render(
    <App
      data={data}
      statusFetch={statusFetch}
      visibility={visible}
      now={() => NOW}
      mapView={null}
      announceDelayMs={50}
      geolocation={null}
      storage={storage}
    />,
  );
}

const FAST = 'Fast only (50 kW or more)';

type User = ReturnType<typeof userEvent.setup>;

async function pickConnector(user: User, label: string) {
  await user.click(screen.getByRole('button', { name: /^Connector:/ }));
  await user.click(screen.getByRole('radio', { name: label }));
}

async function setCustomEnergy(user: User, value: string) {
  if (!screen.queryByLabelText('Energy to add (kWh)')) {
    if (!screen.queryByRole('radio', { name: 'Custom' })) await user.click(screen.getByRole('button', { name: /^Energy:/ }));
    await user.click(screen.getByRole('radio', { name: 'Custom' }));
  }
  const input = screen.getByLabelText('Energy to add (kWh)');
  await user.clear(input);
  if (value) await user.type(input, value);
  return input;
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
    await screen.findByRole('article', { name: 'Alpha AC' });
    // 30 kWh * 0.20 * 1.255
    expect(within(card('Alpha AC')).getByText('€7.53', { selector: '.price-value' })).toBeInTheDocument();
    expect(within(card('Alpha AC')).getByText('estimated')).toBeInTheDocument();
    expect(within(card('Bravo DC')).getByText('€12.00', { selector: '.price-value' })).toBeInTheDocument();
    expect(within(card('Charlie no price')).getByText('Price not in the open data')).toBeInTheDocument();
    expect(within(card('Delta congestion')).getByText(/Can't estimate: .*CONGESTION_TIME/)).toBeInTheDocument();
  });

  it('sorts by estimated cost, then distance and power', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('article', { name: 'Alpha AC' });
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
    await screen.findByRole('article', { name: 'Alpha AC' });
    await user.click(screen.getByLabelText(FAST));
    expect(names()).toEqual(['Bravo DC', 'Delta congestion']);
    await user.click(screen.getByLabelText(FAST));
    await pickConnector(user, 'Type 2');
    expect(names()).toEqual(['Alpha AC', 'Charlie no price']);
    expect(screen.getByRole('button', { name: 'Connector: Type 2' })).toBeInTheDocument();
  });

  it('recomputes the estimate when energy changes and flags bad input', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('article', { name: 'Alpha AC' });
    await setCustomEnergy(user, '10');
    // 10 * 0.20 * 1.255
    expect(within(card('Alpha AC')).getByText('€2.51', { selector: '.price-value' })).toBeInTheDocument();
    const energy = await setCustomEnergy(user, '');
    expect(screen.getByText('Enter a number from 1 to 200.')).toBeInTheDocument();
    expect(energy).toHaveAttribute('aria-invalid', 'true');
    // Keeps the last valid estimate.
    expect(within(card('Alpha AC')).getByText('€2.51', { selector: '.price-value' })).toBeInTheDocument();
  });

  it('shows live availability with its age and flags stale statuses', async () => {
    renderApp();
    await screen.findByRole('article', { name: 'Alpha AC' });
    const alpha = card('Alpha AC');
    await waitFor(() => expect(within(alpha).getByText('1 of 2 free')).toBeInTheDocument());
    await userEvent.setup().click(within(alpha).getByRole('button', { name: 'Details: Alpha AC' }));
    expect(alpha).toHaveTextContent('1 free, 1 in use');
    expect(alpha).toHaveTextContent('status 3 h ago');
    expect(alpha).not.toHaveTextContent('may be outdated');
    const bravo = card('Bravo DC');
    expect(bravo).toHaveTextContent('status 30 h ago');
    expect(bravo).toHaveTextContent('may be outdated');
    expect(card('Charlie no price')).toHaveTextContent('No live status');
    await userEvent.setup().click(within(card('Charlie no price')).getByRole('button', { name: 'Details: Charlie no price' }));
    expect(card('Charlie no price')).toHaveTextContent('1 with no live status');
  });

  it('shows a loading state before statuses arrive', async () => {
    renderApp(() => new Promise<Response>(() => {}));
    await screen.findByRole('article', { name: 'Alpha AC' });
    expect(within(card('Alpha AC')).getByText('Checking…')).toBeInTheDocument();
  });

  it('expands the cost breakdown', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('article', { name: 'Alpha AC' });
    const alpha = card('Alpha AC');
    await user.click(within(alpha).getByRole('button', { name: 'Details: Alpha AC' }));
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

describe('charge bar', () => {
  it('works with the keyboard alone', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('article', { name: 'Alpha AC' });
    const energyChip = screen.getByRole('button', { name: 'Energy: 30 kWh' });
    energyChip.focus();
    await user.keyboard('{Enter}');
    expect(energyChip).toHaveAttribute('aria-expanded', 'true');
    // Focus lands on the selected preset; arrow keys change it without closing the panel.
    expect(screen.getByRole('radio', { name: '30 kWh' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: '50 kWh' })).toBeChecked();
    expect(energyChip).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Energy: 50 kWh' })).toHaveFocus();
    expect(screen.queryByRole('radio', { name: '50 kWh' })).not.toBeInTheDocument();
    // 50 * 0.20 * 1.255
    expect(within(card('Alpha AC')).getByText('€12.55', { selector: '.price-value' })).toBeInTheDocument();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Start: Now' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: /^Connector:/ })).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText(FAST)).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByLabelText(FAST)).toBeChecked();
    expect(names()).toEqual(['Bravo DC', 'Delta congestion']);
  });

  it('closes a panel with Done and on a pointer pick', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('article', { name: 'Alpha AC' });
    await user.click(screen.getByRole('button', { name: 'Start: Now' }));
    await user.click(screen.getByRole('radio', { name: 'Tonight 22:00' }));
    expect(screen.queryByRole('radio', { name: 'Now' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start: Tonight 22:00' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start: Tonight 22:00' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('radio', { name: 'Now' })).not.toBeInTheDocument();
  });

  it('remembers the last settings', async () => {
    const user = userEvent.setup();
    const m = new Map<string, string>();
    const storage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    } as unknown as Storage;
    const first = renderApp(statusesFetch(baseStatuses), storage);
    await screen.findByRole('article', { name: 'Alpha AC' });
    await user.click(screen.getByRole('button', { name: 'Energy: 30 kWh' }));
    await user.click(screen.getByRole('radio', { name: '10 kWh' }));
    await user.click(screen.getByLabelText(FAST));
    first.unmount();
    renderApp(statusesFetch(baseStatuses), storage);
    expect(screen.getByRole('button', { name: 'Energy: 10 kWh' })).toBeInTheDocument();
    expect(screen.getByLabelText(FAST)).toBeChecked();
  });

  it('switches region from the header', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('article', { name: 'Alpha AC' });
    await user.click(screen.getByRole('radio', { name: 'Finland' }));
    await waitFor(() => expect(screen.getByText(/found in Finland/)).toBeInTheDocument());
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

    await user.click(screen.getByLabelText(FAST));
    await pickConnector(user, 'CCS');
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
    await waitFor(() => expect(card('Alpha AC')).toHaveTextContent('1 of 2 free'));

    const changes: string[] = [];
    const observer = new MutationObserver(() => changes.push(region.textContent ?? ''));
    observer.observe(region, { childList: true, subtree: true, characterData: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await waitFor(() => expect(card('Alpha AC')).toHaveTextContent('2 of 2 free'));
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
    await screen.findByRole('article', { name: 'Alpha AC' });
    await waitFor(() => expect(card('Alpha AC')).toHaveTextContent('1 of 2 free'));
    await user.click(within(card('Alpha AC')).getByRole('button', { name: 'Details: Alpha AC' }));
    // jsdom has no layout or computed colours, so contrast is checked by hand instead (see src/styles.css).
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
});
