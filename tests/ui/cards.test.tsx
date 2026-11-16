import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/App.tsx';
import type { ApiStatus } from '../../src/data/api.ts';
import type { DataSource } from '../../src/data/source.ts';
import type { Charger, Meta, TariffFile } from '../../src/data/types.ts';
import type { FetchLike, Visibility } from '../../src/live/statuses.ts';

const NOW = Date.parse('2026-11-16T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const energy = (id: string, price: number, taxIncluded = 'YES') => ({
  id,
  currency: 'EUR',
  taxIncluded,
  elements: [{ priceComponents: [{ type: 'ENERGY', price, vat: 25.5, stepSize: 1 }] }],
});

const tariffs: TariffFile = {
  p20: energy('p20', 0.2),
  p30: energy('p30', 0.3),
  p40: energy('p40', 0.4),
  congestion: {
    id: 'congestion',
    currency: 'EUR',
    taxIncluded: 'NO',
    elements: [{ priceComponents: [{ type: 'CONGESTION_TIME', price: 30, stepSize: 60 }] }],
  },
};

function charger(id: string, name: string, lat: number, evses: Charger['evses'], open247 = false): Charger {
  return { id, name, address: `${name}tie 1, 90100 Oulu`, lat, lon: 25.4682, operator: `Operator ${id}`, open247, evses };
}

const T2 = ['IEC_62196_T2'];
const CCS = ['IEC_62196_T2_COMBO'];

const chargers: Charger[] = [
  // 30 kWh * 0.20 = 6.00, but busy
  charger('busy', 'Busy cheap', 65.013, [{ id: 'busy1', kw: 22, standards: T2, tariffIds: ['p20'] }]),
  // AC 6.00 * 1.5 = 9.00 and DC 12.00: a range
  charger('range', 'Range place', 65.02, [
    { id: 'r1', kw: 22, standards: T2, tariffIds: ['p30'] },
    { id: 'r2', kw: 150, standards: CCS, tariffIds: ['p40'] },
  ], true),
  // 9.00, free, farther than Range place
  charger('single', 'Single price', 65.04, [{ id: 's1', kw: 50, standards: CCS, tariffIds: ['p30'] }]),
  charger('none', 'No price place', 65.014, [{ id: 'n1', kw: 11, standards: T2, tariffIds: [] }]),
  charger('refused', 'Refused place', 65.05, [{ id: 'x1', kw: 300, standards: CCS, tariffIds: ['congestion'] }]),
];

const statuses: ApiStatus[] = [
  { evseId: 'busy1', status: 'CHARGING', modifiedAt: hoursAgo(1), lastUpdatedAt: hoursAgo(1) },
  { evseId: 'r1', status: 'AVAILABLE', modifiedAt: hoursAgo(2), lastUpdatedAt: hoursAgo(2) },
  { evseId: 'r2', status: 'AVAILABLE', modifiedAt: hoursAgo(2), lastUpdatedAt: hoursAgo(2) },
  { evseId: 's1', status: 'AVAILABLE', modifiedAt: hoursAgo(40), lastUpdatedAt: hoursAgo(40) },
  { evseId: 'x1', status: 'OUTOFORDER', modifiedAt: hoursAgo(1), lastUpdatedAt: hoursAgo(1) },
];

const meta: Meta = {
  builtAt: '2026-11-16T03:17:00Z',
  source: 'test',
  license: 'CC BY 4.0',
  attribution: 'Data: Fintraffic / digitraffic.fi, CC BY 4.0',
  counts: { locations: 5, evses: 6, evsesWithTariff: 5, tariffs: 4 },
  regions: {
    oulu: { label: 'Oulu', bbox: [64.85, 25.2, 65.15, 25.9], chargers: 5, evses: 6 },
    finland: { label: 'Finland', bbox: null, chargers: 5, evses: 6 },
  },
};

function source(list: Charger[]): DataSource {
  return { meta: async () => meta, tariffs: async () => tariffs, region: async (id) => ({ region: id, chargers: list }) };
}

const fetchStatuses = (list: ApiStatus[]): FetchLike => async () =>
  new Response(JSON.stringify({ statuses: list, pagination: { nextCursor: null } }));

const visible: Visibility = { isHidden: () => false, subscribe: () => () => {} };

function renderApp(list = chargers, live: ApiStatus[] | null = statuses) {
  return render(
    <App
      data={source(list)}
      statusFetch={live ? fetchStatuses(live) : null}
      visibility={visible}
      now={() => NOW}
      mapView={null}
      announceDelayMs={10}
      geolocation={null}
      storage={null}
    />,
  );
}

const card = (name: string) => screen.getByRole('article', { name });
const best = () => screen.getByRole('region', { name: 'Best right now' });

describe('result card states', () => {
  it('shows a single price, a range, no price and a refusal', async () => {
    renderApp();
    await waitFor(() => expect(card('Range place')).toHaveTextContent('2 of 2 free'));
    expect(within(card('Single price')).getByText('€9.00', { selector: '.price-value' })).toBeInTheDocument();
    expect(within(card('Range place')).getByText('€9.00–€12.00', { selector: '.price-value' })).toBeInTheDocument();
    expect(within(card('No price place')).getByText('Price not in the open data')).toBeInTheDocument();
    const refused = card('Refused place');
    expect(within(refused).getByText("Can't estimate")).toBeInTheDocument();
    expect(refused).toHaveTextContent(/Can't estimate: .*congestion fee/);
  });

  it('shows availability with shape and text, freshness and the stale flag', async () => {
    renderApp();
    await waitFor(() => expect(card('Range place')).toHaveTextContent('2 of 2 free'));
    expect(card('Busy cheap')).toHaveTextContent('In use');
    expect(card('Refused place')).toHaveTextContent('Out of order');
    expect(card('No price place')).toHaveTextContent('No live status');
    expect(card('Range place')).toHaveTextContent('status 2 h ago');
    expect(card('Range place')).not.toHaveTextContent('may be outdated');
    expect(card('Single price')).toHaveTextContent('status 40 h ago · may be outdated');
    expect(card('Range place').querySelector('.shape-free')).not.toBeNull();
    expect(card('Busy cheap').querySelector('.shape-busy')).not.toBeNull();
  });

  it('shows power badge, connectors and distance', async () => {
    renderApp();
    const c = await screen.findByRole('article', { name: 'Range place' });
    expect(c).toHaveTextContent('150 kW DC');
    expect(c).toHaveTextContent('Type 2, CCS');
    expect(c).toHaveTextContent(/\d+ m · Operator range/);
  });

  it('expands to breakdown, why a range, opening hours and directions', async () => {
    const user = userEvent.setup();
    renderApp();
    const c = await screen.findByRole('article', { name: 'Range place' });
    const toggle = within(c).getByRole('button', { name: 'Details: Range place' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(c).getAllByRole('table')).toHaveLength(2);
    await user.click(within(c).getByText('Why a range?'));
    expect(c).toHaveTextContent('This charger lists 2 prices for your session');
    expect(c).toHaveTextContent('Open 24/7');
    expect(within(c).getByRole('link', { name: /Directions/ })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/dir/?api=1&destination=65.02,25.4682',
    );
    expect(within(c).getByRole('link', { name: 'Open in maps app' }).getAttribute('href')).toMatch(/^geo:65\.02,25\.4682/);
    expect(c).toHaveTextContent('Estimated from the published tariff.');
    await user.click(toggle);
    expect(within(c).queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows "no live status" pills while statuses are off and still shows prices', async () => {
    renderApp(chargers, null);
    const c = await screen.findByRole('article', { name: 'Single price' });
    expect(within(c).getByText('Checking…')).toBeInTheDocument();
    expect(within(c).getByText('€9.00', { selector: '.price-value' })).toBeInTheDocument();
    expect(best()).toHaveTextContent('Checking which chargers are free…');
  });
});

describe('best right now', () => {
  it('picks the cheapest free charger, nearest on a tie', async () => {
    renderApp();
    await waitFor(() => expect(best()).toHaveTextContent('Range place'));
    // Busy cheap is cheaper but in use; Single price ties at 9.00 but is farther.
    expect(best()).toHaveTextContent('€9.00–€12.00');
    expect(best()).toHaveTextContent('2 of 2 free');
    expect(best()).toHaveTextContent('30 kWh at up to 11 kW, starting now. Estimated from the published tariff.');
  });

  it('opens the card from "See details"', async () => {
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(best()).toHaveTextContent('Range place'));
    await user.click(within(best()).getByRole('button', { name: 'See details: Range place' }));
    expect(within(card('Range place')).getByRole('button', { name: 'Details: Range place' })).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(card('Range place')).toHaveFocus());
  });

  it('says why nothing qualifies and offers the fix', async () => {
    const user = userEvent.setup();
    renderApp([chargers[0]!, chargers[3]!]);
    await waitFor(() => expect(best()).toHaveTextContent('No free chargers match right now.'));
    // Neither of these is fast, so turning on Fast only leaves nothing.
    await user.click(screen.getByLabelText('Fast only (50 kW or more)'));
    await waitFor(() => expect(best()).toHaveTextContent("No fast chargers match. Try turning off 'Fast only'."));
    await user.click(within(best()).getByRole('button', { name: "Turn off 'Fast only'" }));
    expect(screen.getByLabelText('Fast only (50 kW or more)')).not.toBeChecked();
  });
});

describe('empty state', () => {
  it('suggests fixes that change the filters', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('article', { name: 'Range place' });
    await user.click(screen.getByRole('button', { name: /^Connector:/ }));
    await user.click(screen.getByRole('radio', { name: 'CHAdeMO' }));
    expect(screen.getByText('Nothing matches these filters in Oulu.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search all of Finland' })).toBeInTheDocument();
    const fixes = screen.getAllByRole('button', { name: 'Use any connector' });
    await user.click(fixes[fixes.length - 1]!);
    expect(await screen.findByRole('article', { name: 'Range place' })).toBeInTheDocument();
  });
});
