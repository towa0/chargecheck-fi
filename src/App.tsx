import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { ChargeBar } from './components/ChargeBar.tsx';
import { Header } from './components/Header.tsx';
import { ListIcon, MapIcon } from './components/Icons.tsx';
import { ResultItem } from './components/ResultItem.tsx';
import type { MapViewProps } from './components/MapView.tsx';
import { DEFAULT_POINT } from './data/regions.ts';
import { httpDataSource, type DataSource } from './data/source.ts';
import type { Meta, RegionFile, TariffFile } from './data/types.ts';
import { useAnnouncement } from './hooks/useAnnouncement.ts';
import { useMediaQuery } from './hooks/useMediaQuery.ts';
import { useStatuses } from './hooks/useStatuses.ts';
import { documentVisibility, type FetchLike, type Visibility } from './live/statuses.ts';
import { buildResults, type EstimateCache, type Point, type SortKey } from './logic/results.ts';
import { loadSettings, resolveStart, saveSettings, type Settings } from './logic/settings.ts';

const PAGE_SIZE = 50;
const REPO_URL = 'https://github.com/towa0/chargecheck-fi';
const WIDE = '(min-width: 60em)';
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
  storage?: Storage | null;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

function defaultStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
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
  storage = defaultStorage(),
}: AppProps) {
  const [settings, setSettingsState] = useState<Settings>(() => loadSettings(storage));
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
  const [view, setView] = useState<'list' | 'map'>('list');
  const [clock, setClock] = useState(now);
  const wide = useMediaQuery(WIDE);
  const reducedMotion = useMemo(prefersReducedMotion, []);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const cache = useRef<EstimateCache>(new Map());

  const setSettings = useCallback(
    (next: Settings) => {
      setSettingsState(next);
      saveSettings(storage, next);
    },
    [storage],
  );

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
    if (regions[settings.region]) return undefined;
    let cancelled = false;
    data
      .region(settings.region)
      .then((r) => !cancelled && setRegions((prev) => ({ ...prev, [settings.region]: r })))
      .catch(() => !cancelled && setLoadError('The charger data could not be loaded. Try reloading the page.'));
    return () => {
      cancelled = true;
    };
  }, [data, settings.region, regions]);

  // Status ages are relative, so refresh "now" whenever statuses arrive.
  useEffect(() => setClock(now()), [statuses, now]);

  const start = resolveStart(settings, clock);
  const startMs = start.getTime();
  const region = regions[settings.region];
  const results = useMemo(() => {
    if (!region || !tariffs) return null;
    if (cache.current.size > 50_000) cache.current = new Map();
    return buildResults(
      region.chargers,
      tariffs,
      statuses,
      {
        energyKWh: settings.energyKWh,
        start: new Date(startMs),
        fastOnly: settings.fastOnly,
        connector: settings.connector,
        sort: settings.sort,
      },
      point,
      cache.current,
    );
  }, [region, tariffs, statuses, settings.energyKWh, startMs, settings.fastOnly, settings.connector, settings.sort, point]);

  const filterKey = [
    results ? 'ready' : 'loading',
    settings.region,
    settings.fastOnly,
    settings.connector,
    settings.sort,
    settings.energyKWh,
    settings.timeMode,
    settings.customStart,
    point.lat,
    point.lon,
  ].join('|');

  useEffect(() => setShown(PAGE_SIZE), [filterKey]);

  const count = results?.length ?? 0;
  const regionLabel = meta?.regions[settings.region]?.label ?? settings.region;
  const countText = results ? `${count} ${count === 1 ? 'charger' : 'chargers'} found in ${regionLabel}.` : '';
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
      if (el && wide) {
        el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
        el.focus({ preventScroll: true });
      }
    },
    [reducedMotion, wide],
  );

  const distanceFrom = locationError
    ? "Couldn't get your location. Distances are from Oulu city centre."
    : pointIsUser
      ? 'Distances from your location'
      : 'Distances from Oulu city centre';

  const MapComponent = mapView;
  const showMap = Boolean(MapComponent) && (wide || view === 'map');
  const showList = wide || view === 'list' || !MapComponent;

  return (
    <div className={`app ${showMap && !wide ? 'app-mapview' : ''}`}>
      <a className="skip-link" href="#results">
        Skip to results
      </a>
      <Header
        region={settings.region}
        onRegion={(id) => setSettings({ ...settings, region: id })}
        onUseLocation={geolocation ? onUseLocation : null}
        locating={locating}
        usingLocation={pointIsUser}
      />
      <section className="chargebar-wrap" aria-label="Your charge">
        <h1 className="visually-hidden">ChargeCheck Finland: find a free charger and what it costs</h1>
        <ChargeBar settings={settings} onChange={setSettings} now={clock} />
      </section>

      {MapComponent && !wide && (
        <div className="viewswitch" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
            <ListIcon /> List
          </button>
          <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')}>
            <MapIcon /> Map
          </button>
        </div>
      )}

      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <div className="split">
        <main className="results-pane" id="results" tabIndex={-1} hidden={!showList}>
          {loadError && (
            <p className="notice notice-error" role="alert">
              {loadError}
            </p>
          )}
          <div className="results-head">
            <h2 id="results-heading" className="results-title">
              Chargers
            </h2>
            <div className="sort">
              <label htmlFor="sort">Sort by</label>
              <select
                id="sort"
                value={settings.sort}
                onChange={(e) => setSettings({ ...settings, sort: e.target.value as SortKey })}
              >
                <option value="cost">Estimated cost</option>
                <option value="distance">Distance</option>
                <option value="power">Power</option>
              </select>
            </div>
          </div>
          {statusError && (
            <p className="notice">Live status is not available right now. I'll try again in a minute.</p>
          )}
          {!results && !loadError && <p className="muted">Loading chargers…</p>}
          {results && (
            <>
              <p className="result-count muted">
                {count === 0
                  ? 'No chargers match. Try another connector or turn off "Fast only".'
                  : `Showing ${Math.min(shown, count)} of ${countText} ${distanceFrom}.`}
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
                      onShowOnMap={null}
                    />
                  </li>
                ))}
              </ol>
              {count > shown && (
                <button type="button" className="btn more" onClick={() => setShown((s) => s + PAGE_SIZE)}>
                  Show {Math.min(PAGE_SIZE, count - shown)} more
                </button>
              )}
            </>
          )}
        </main>

        {showMap && MapComponent && (
          <section className="map-pane" aria-label="Map">
            <Suspense fallback={<p className="muted map-loading">Loading map…</p>}>
              <MapComponent results={visible} selectedId={selectedId} onSelect={onMarkerSelect} reducedMotion={reducedMotion} />
            </Suspense>
          </section>
        )}
      </div>
      {showList && <Footer meta={meta} />}
    </div>
  );
}

function Footer({ meta }: { meta: Meta | null }) {
  return (
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
        Not affiliated with any operator. <a href={REPO_URL}>Source code</a>
      </p>
    </footer>
  );
}

function formatBuilt(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Helsinki',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}
