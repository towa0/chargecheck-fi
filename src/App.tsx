import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Controls, parseEnergy, type ControlValues } from './components/Controls.tsx';
import { ResultItem } from './components/ResultItem.tsx';
import type { MapViewProps } from './components/MapView.tsx';
import { DEFAULT_POINT } from './data/regions.ts';
import { httpDataSource, type DataSource } from './data/source.ts';
import type { Meta, RegionFile, TariffFile } from './data/types.ts';
import { useAnnouncement } from './hooks/useAnnouncement.ts';
import { useStatuses } from './hooks/useStatuses.ts';
import { documentVisibility, type FetchLike, type Visibility } from './live/statuses.ts';
import { buildResults, type EstimateCache, type Point } from './logic/results.ts';
import { parseLocalDateTime, toLocalInputValue } from './tariff/time.ts';

const PAGE_SIZE = 50;
const REPO_URL = 'https://github.com/towa0/chargecheck-fi';
const LazyMap = lazy(() => import('./components/MapView.tsx'));

export interface AppProps {
  data?: DataSource;
  /** Fetch used for live statuses. null turns live statuses off. */
  statusFetch?: FetchLike | null;
  visibility?: Visibility | null;
  now?: () => number;
  /** Map component, or null to leave the map out. */
  mapView?: ComponentType<MapViewProps> | null;
  announceDelayMs?: number;
  geolocation?: Geolocation | null;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

function wideScreen(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(min-width: 60em)').matches
    : false;
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

export function App({
  data = httpDataSource,
  statusFetch = defaultFetch,
  visibility = typeof document !== 'undefined' ? documentVisibility() : null,
  now = Date.now,
  mapView = LazyMap,
  announceDelayMs = 1000,
  geolocation = typeof navigator !== 'undefined' && 'geolocation' in navigator ? navigator.geolocation : null,
}: AppProps) {
  const [values, setValues] = useState<ControlValues>(() => ({
    energy: '30',
    fastOnly: false,
    connector: '',
    start: toLocalInputValue(new Date(now())),
    region: 'oulu',
    sort: 'cost',
  }));
  const [meta, setMeta] = useState<Meta | null>(null);
  const [tariffs, setTariffs] = useState<TariffFile | null>(null);
  const [regions, setRegions] = useState<Record<string, RegionFile>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [point, setPoint] = useState<Point>(DEFAULT_POINT);
  const [pointIsUser, setPointIsUser] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(wideScreen);
  const [clock, setClock] = useState(now);
  const reducedMotion = useMemo(prefersReducedMotion, []);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const cache = useRef<EstimateCache>(new Map());

  const { statuses, error: statusError } = useStatuses(statusFetch, visibility);

  useEffect(() => {
    let cancelled = false;
    Promise.all([data.meta(), data.tariffs()])
      .then(([m, t]) => {
        if (cancelled) return;
        setMeta(m);
        setTariffs(t);
      })
      .catch(() => !cancelled && setLoadError('The charger data could not be loaded. Try reloading the page.'));
    return () => {
      cancelled = true;
    };
  }, [data]);

  useEffect(() => {
    if (regions[values.region]) return undefined;
    let cancelled = false;
    data
      .region(values.region)
      .then((r) => !cancelled && setRegions((prev) => ({ ...prev, [values.region]: r })))
      .catch(() => !cancelled && setLoadError('The charger data could not be loaded. Try reloading the page.'));
    return () => {
      cancelled = true;
    };
  }, [data, values.region, regions]);

  // Status ages are relative, so refresh "now" whenever statuses arrive.
  useEffect(() => setClock(now()), [statuses, now]);

  const energy = parseEnergy(values.energy);
  const start = parseLocalDateTime(values.start);
  const [lastGood, setLastGood] = useState({ energy: 30, start: start ?? new Date(now()) });
  useEffect(() => {
    if (energy !== null && start !== null) {
      if (energy !== lastGood.energy || start.getTime() !== lastGood.start.getTime()) setLastGood({ energy, start });
    }
  }, [energy, start, lastGood]);

  const region = regions[values.region];
  const results = useMemo(() => {
    if (!region || !tariffs) return null;
    if (cache.current.size > 50_000) cache.current = new Map();
    return buildResults(
      region.chargers,
      tariffs,
      statuses,
      {
        energyKWh: lastGood.energy,
        start: lastGood.start,
        fastOnly: values.fastOnly,
        connector: values.connector,
        sort: values.sort,
      },
      point,
      cache.current,
    );
  }, [region, tariffs, statuses, lastGood, values.fastOnly, values.connector, values.sort, point]);

  const filterKey = [
    results ? 'ready' : 'loading',
    values.region,
    values.fastOnly,
    values.connector,
    values.sort,
    lastGood.energy,
    lastGood.start.getTime(),
    point.lat,
    point.lon,
  ].join('|');

  useEffect(() => setShown(PAGE_SIZE), [filterKey]);

  const count = results?.length ?? 0;
  const regionLabel = meta?.regions[values.region]?.label ?? values.region;
  const countText = results
    ? `${count} ${count === 1 ? 'charger' : 'chargers'} found in ${regionLabel}.`
    : '';
  const announcement = useAnnouncement(countText, filterKey, announceDelayMs);

  const visible = results ? results.slice(0, shown) : [];

  const onUseLocation = useCallback(() => {
    if (!geolocation) return;
    setLocating(true);
    setLocationError(false);
    geolocation.getCurrentPosition(
      (pos) => {
        setPoint({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setPointIsUser(true);
        setLocating(false);
      },
      () => {
        setLocationError(true);
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 },
    );
  }, [geolocation]);

  const onMarkerSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      const el = itemRefs.current.get(id);
      if (el) {
        el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
        el.focus({ preventScroll: true });
      }
    },
    [reducedMotion],
  );

  const locationLabel = locationError
    ? "Couldn't get your location. Distances are from Oulu city centre."
    : pointIsUser
      ? 'Distances are from your location.'
      : 'Distances are from Oulu city centre.';

  const MapComponent = mapView;

  return (
    <>
      <a className="skip-link" href="#results">
        Skip to results
      </a>
      <header className="site-header">
        <h1>ChargeCheck Finland</h1>
        <p>Find a charger that's free right now, and see what charging there would cost.</p>
      </header>
      <main>
        <section aria-labelledby="options-heading" className="panel">
          <h2 id="options-heading">Your charge</h2>
          <Controls
            values={values}
            onChange={setValues}
            startValid={start !== null}
            locationLabel={locationLabel}
            locating={locating}
            onUseLocation={geolocation ? onUseLocation : null}
          />
        </section>

        <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </div>

        {loadError && (
          <p className="notice notice-error" role="alert">
            {loadError}
          </p>
        )}

        {MapComponent && (
          <section aria-labelledby="map-heading" className="map-section">
            <div className="map-header">
              <h2 id="map-heading">Map</h2>
              <button type="button" aria-expanded={mapOpen} aria-controls="map-area" onClick={() => setMapOpen((o) => !o)}>
                {mapOpen ? 'Hide map' : 'Show map'}
              </button>
            </div>
            <div id="map-area" hidden={!mapOpen}>
              {mapOpen && (
                <>
                  <p className="muted map-legend">
                    <span className="pin pin-yes pin-inline" aria-hidden="true"><span>2</span></span> circle: number free ·{' '}
                    <span className="pin pin-no pin-inline" aria-hidden="true"><span>0</span></span> square: none free ·{' '}
                    <span className="pin pin-unknown pin-inline" aria-hidden="true"><span>?</span></span> diamond: no live status.
                    The map shows the chargers listed below.
                  </p>
                  <Suspense fallback={<p className="muted">Loading map…</p>}>
                    <MapComponent
                      results={visible}
                      selectedId={selectedId}
                      onSelect={onMarkerSelect}
                      reducedMotion={reducedMotion}
                    />
                  </Suspense>
                </>
              )}
            </div>
          </section>
        )}

        <section aria-labelledby="results-heading" className="results-section" id="results" tabIndex={-1}>
          <h2 id="results-heading">Chargers</h2>
          {statusError && (
            <p className="notice">Live status is not available right now. I'll try again in a minute.</p>
          )}
          {!results && !loadError && <p className="muted">Loading chargers…</p>}
          {results && (
            <>
              <p className="result-count">
                {count === 0
                  ? 'No chargers match. Try another connector or turn off "Fast chargers only".'
                  : `Showing ${Math.min(shown, count)} of ${countText}`}
              </p>
              <ol className="results" aria-labelledby="results-heading">
                {visible.map((r) => (
                  <li key={r.charger.id}>
                    <ResultItem
                      ref={(el) => {
                        if (el) itemRefs.current.set(r.charger.id, el);
                        else itemRefs.current.delete(r.charger.id);
                      }}
                      result={r}
                      now={clock}
                      selected={r.charger.id === selectedId}
                      onShowOnMap={MapComponent && mapOpen ? () => setSelectedId(r.charger.id) : null}
                    />
                  </li>
                ))}
              </ol>
              {count > shown && (
                <button type="button" className="more" onClick={() => setShown((s) => s + PAGE_SIZE)}>
                  Show {Math.min(PAGE_SIZE, count - shown)} more
                </button>
              )}
            </>
          )}
        </section>
      </main>
      <footer className="site-footer">
        <p>
          Data: <a href="https://www.digitraffic.fi/">Fintraffic / digitraffic.fi</a>,{' '}
          <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.
        </p>
        <p>Estimates from published tariffs. Prices in apps or via roaming can differ.</p>
        <p>
          {meta && (
            <>
              Charger data built <time dateTime={meta.builtAt}>{formatBuilt(meta.builtAt)}</time>.{' '}
            </>
          )}
          Not affiliated with any operator.
        </p>
        <p>
          <a href={REPO_URL}>Source code on GitHub</a>
        </p>
      </footer>
    </>
  );
}

function formatBuilt(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Helsinki',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}
