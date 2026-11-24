import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/App.tsx';
import type { DataSource } from '../../src/data/source.ts';
import type { Charger, Meta } from '../../src/data/types.ts';
import type { Tariff } from '../../src/tariff/types.ts';
import type { FetchLike, Visibility } from '../../src/live/statuses.ts';
import fixtureFile from '../fixtures/tariffs.json' with { type: 'json' };

// 16 Nov 2026 12:00 UTC is 14:00 in Helsinki.
const NOW = Date.parse('2026-11-16T12:00:00Z');
const F = fixtureFile.tariffs as unknown as Record<string, Tariff>;
const dayNight = { ...F.dayNightTaxIncluded!, startDateTime: undefined };

const chargers: Charger[] = [
  {
    id: 'dn',
    name: 'Day night place',
    address: '',
    lat: 65.02,
    lon: 25.47,
    operator: 'Op',
    open247: true,
    evses: [{ id: 'dn1', kw: 22, standards: ['IEC_62196_T2'], tariffIds: [dayNight.id] }],
  },
  {
    id: 'flat',
    name: 'Flat place',
    address: '',
    lat: 65.03,
    lon: 25.47,
    operator: 'Op',
    open247: true,
    evses: [{ id: 'f1', kw: 22, standards: ['IEC_62196_T2'], tariffIds: [F.energyOnly!.id] }],
  },
];

const meta: Meta = {
  builtAt: '2026-11-16T03:17:00Z',
  source: 'test',
  license: 'CC BY 4.0',
  attribution: 'Data: Fintraffic / digitraffic.fi, CC BY 4.0',
  counts: { locations: 2, evses: 2, evsesWithTariff: 2, tariffs: 2 },
  regions: { oulu: { label: 'Oulu', bbox: null, chargers: 2, evses: 2 }, finland: { label: 'Finland', bbox: null, chargers: 2, evses: 2 } },
};

const data: DataSource = {
  meta: async () => meta,
  tariffs: async () => ({ [dayNight.id]: dayNight, [F.energyOnly!.id]: F.energyOnly! }),
  region: async (id) => ({ region: id, chargers }),
};

const statusFetch: FetchLike = async () =>
  new Response(
    JSON.stringify({
      statuses: ['dn1', 'f1'].map((evseId) => ({ evseId, status: 'AVAILABLE', modifiedAt: '2026-11-16T11:00:00Z', lastUpdatedAt: '2026-11-16T11:00:00Z' })),
      pagination: { nextCursor: null },
    }),
  );
const visible: Visibility = { isHidden: () => false, subscribe: () => () => {} };

describe('cheaper later hint', () => {
  it('shows the saving for a day/night tariff on the card and the best card, not for a flat price', async () => {
    render(
      <App lang="en" data={data} statusFetch={statusFetch} visibility={visible} now={() => NOW} mapView={null} announceDelayMs={10} geolocation={null} storage={null} />,
    );
    // 30 kWh at 11 kW from 14:00 is all at 0.28 = 8.40; from 21:00 all at 0.19 = 5.70.
    const card = await screen.findByRole('article', { name: 'Day night place' });
    expect(within(card).getByText(/2,70 € cheaper from 21:00/)).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Flat place' })).not.toHaveTextContent('cheaper');
    const best = screen.getByRole('region', { name: 'Best right now' });
    await waitFor(() => expect(best).toHaveTextContent('Flat place'));
    expect(best).not.toHaveTextContent('cheaper');
  });
});

describe('cheaper later on the best card', () => {
  it('shows the hint prominently when the best charger has one', async () => {
    const only: DataSource = { ...data, region: async (id) => ({ region: id, chargers: [chargers[0]!] }) };
    render(
      <App lang="en" data={only} statusFetch={statusFetch} visibility={visible} now={() => NOW} mapView={null} announceDelayMs={10} geolocation={null} storage={null} />,
    );
    const best = await screen.findByRole('region', { name: 'Best right now' });
    await waitFor(() => expect(best).toHaveTextContent('Day night place'));
    expect(within(best).getByText('2,70 € cheaper from 21:00')).toHaveClass('hero-hint');
    expect(best).toHaveTextContent('Estimated from the published tariff.');
  });
});
