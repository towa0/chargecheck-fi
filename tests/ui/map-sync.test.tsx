import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App.tsx';
import type { MapViewProps } from '../../src/components/MapView.tsx';
import type { ApiStatus } from '../../src/data/api.ts';
import type { DataSource } from '../../src/data/source.ts';
import type { Charger, Meta, TariffFile } from '../../src/data/types.ts';
import type { FetchLike, Visibility } from '../../src/live/statuses.ts';

const NOW = Date.parse('2026-11-16T12:00:00Z');

const tariffs: TariffFile = {
  t: { id: 't', currency: 'EUR', taxIncluded: 'YES', elements: [{ priceComponents: [{ type: 'ENERGY', price: 0.3, stepSize: 1 }] }] },
};

const charger = (id: string, name: string, lat: number, kw: number): Charger => ({
  id,
  name,
  address: '',
  lat,
  lon: 25.47,
  operator: 'Op',
  open247: false,
  evses: [{ id: `${id}1`, kw, standards: [kw >= 50 ? 'IEC_62196_T2_COMBO' : 'IEC_62196_T2'], tariffIds: ['t'] }],
});

const chargers = [charger('a', 'Alpha', 65.013, 22), charger('b', 'Bravo', 65.03, 150), charger('c', 'Charlie', 65.06, 11)];

const meta: Meta = {
  builtAt: '2026-11-16T03:17:00Z',
  source: 'test',
  license: 'CC BY 4.0',
  attribution: 'Data: Fintraffic / digitraffic.fi, CC BY 4.0',
  counts: { locations: 3, evses: 3, evsesWithTariff: 3, tariffs: 1 },
  regions: { oulu: { label: 'Oulu', bbox: null, chargers: 3, evses: 3 }, finland: { label: 'Finland', bbox: null, chargers: 3, evses: 3 } },
};

const data: DataSource = { meta: async () => meta, tariffs: async () => tariffs, region: async (id) => ({ region: id, chargers }) };
const visible: Visibility = { isHidden: () => false, subscribe: () => () => {} };

let round = 0;
const statusFetch: FetchLike = async () => {
  round++;
  const s: ApiStatus[] = chargers.map((c) => ({
    evseId: `${c.id}1`,
    status: round === 1 ? 'AVAILABLE' : 'CHARGING',
    modifiedAt: new Date(NOW - 60_000 + round).toISOString(),
    lastUpdatedAt: new Date(NOW - 60_000).toISOString(),
  }));
  return new Response(JSON.stringify({ statuses: s, pagination: { nextCursor: null } }));
};

let props: MapViewProps[] = [];
function FakeMap(p: MapViewProps) {
  props.push(p);
  return (
    <div data-testid="fake-map">
      {p.results.map((r) => (
        <button key={r.charger.id} type="button" onClick={() => p.onSelect(r.charger.id)}>
          pin {r.charger.name}
        </button>
      ))}
    </div>
  );
}
const last = () => props[props.length - 1]!;

function setWide(wide: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (q: string) => ({
      matches: wide && q.includes('min-width'),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  props = [];
  round = 0;
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  // @ts-expect-error jsdom has no matchMedia by default
  delete window.matchMedia;
  vi.useRealTimers();
});

function renderApp() {
  return render(
    <App
      data={data}
      statusFetch={statusFetch}
      visibility={visible}
      now={() => NOW}
      mapView={FakeMap}
      announceDelayMs={10}
      geolocation={null}
      storage={null}
    />,
  );
}

const card = (name: string) => screen.getByRole('article', { name });

describe('list and map sync on wide screens', () => {
  beforeEach(() => setWide(true));

  it('shows list and map together without a view switch', async () => {
    renderApp();
    await screen.findByRole('article', { name: 'Alpha' });
    expect(screen.getByTestId('fake-map')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'View' })).not.toBeInTheDocument();
  });

  it('highlights the pin while a card is hovered or focused', async () => {
    renderApp();
    const alpha = await screen.findByRole('article', { name: 'Alpha' });
    fireEvent.mouseEnter(alpha);
    expect(last().highlightedId).toBe('a');
    fireEvent.mouseLeave(alpha);
    expect(last().highlightedId).toBeNull();
    act(() => within(card('Bravo')).getByRole('button', { name: 'Details: Bravo' }).focus());
    expect(last().highlightedId).toBe('b');
    act(() => within(card('Bravo')).getByRole('button', { name: 'Details: Bravo' }).blur());
    expect(last().highlightedId).toBeNull();
  });

  it('clicking a pin selects, scrolls to and focuses the card', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('article', { name: 'Charlie' });
    await user.click(screen.getByRole('button', { name: 'pin Charlie' }));
    expect(card('Charlie')).toHaveClass('card-selected');
    expect(card('Alpha')).not.toHaveClass('card-selected');
    expect(scrollIntoView).toHaveBeenCalled();
    expect(card('Charlie')).toHaveFocus();
    expect(last().selectedId).toBe('c');
  });

  it('changes the fit key on filter changes but not on status updates', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderApp();
    await waitFor(() => expect(card('Alpha')).toHaveTextContent('1 of 1 free'));
    const before = last().fitKey;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await waitFor(() => expect(card('Alpha')).toHaveTextContent('In use'));
    expect(last().fitKey).toBe(before);
    await user.click(screen.getByLabelText('Fast only (50 kW or more)'));
    expect(last().fitKey).not.toBe(before);
    expect(last().results.map((r) => r.charger.id)).toEqual(['b']);
  });
});

describe('list and map on phones', () => {
  beforeEach(() => setWide(false));

  it('loads the map only when the Map view is chosen', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('article', { name: 'Alpha' });
    expect(screen.queryByTestId('fake-map')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Map' }));
    expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('fake-map')).toBeInTheDocument();
    expect(document.getElementById('results')).not.toBeVisible();
  });

  it('shows a bottom card for the tapped pin and can jump to it in the list', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('article', { name: 'Alpha' });
    await user.click(screen.getByRole('button', { name: 'Map' }));
    await user.click(screen.getByRole('button', { name: 'pin Bravo' }));
    const sheet = screen.getByRole('region', { name: 'Selected charger: Bravo' });
    expect(sheet).toHaveTextContent('€9.00');
    expect(sheet).toHaveTextContent('150 kW DC');
    await user.click(within(sheet).getByRole('button', { name: 'Show in list' }));
    expect(screen.queryByTestId('fake-map')).not.toBeInTheDocument();
    await waitFor(() => expect(card('Bravo')).toHaveFocus());
    expect(within(card('Bravo')).getByRole('button', { name: 'Details: Bravo' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes the bottom card', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('article', { name: 'Alpha' });
    await user.click(screen.getByRole('button', { name: 'Map' }));
    await user.click(screen.getByRole('button', { name: 'pin Alpha' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: /Selected charger/ })).not.toBeInTheDocument();
  });
});
