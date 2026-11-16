import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { ChargeBar } from './components/ChargeBar.tsx';
import { Header } from './components/Header.tsx';
import { ListIcon, MapIcon } from './components/Icons.tsx';
import { BestCard } from './components/BestCard.tsx';
import { BottomCard } from './components/BottomCard.tsx';
import { ResultCard } from './components/ResultCard.tsx';
import type { MapViewProps } from './components/MapView.tsx';
import { DEFAULT_POINT } from './data/regions.ts';
import { httpDataSource, type DataSource } from './data/source.ts';
import type { Meta, RegionFile, TariffFile } from './data/types.ts';
import { useAnnouncement } from './hooks/useAnnouncement.ts';
import { useMediaQuery } from './hooks/useMediaQuery.ts';
import { useStatuses } from './hooks/useStatuses.ts';
import { documentVisibility, type FetchLike, type Visibility } from './live/statuses.ts';
import { buildResults, type EstimateCache, type Point, type SortKey } from './logic/results.ts';
import { pickBest, type BestPick } from './logic/best.ts';
import { cheaperHint, type HintCache } from './logic/hints.ts';
import { loadSettings, resolveStart, saveSettings, timeLabel, type Settings } from './logic/settings.ts';

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

// One shared object: a new one per render would restart the status poller on every render.
let sharedVisibility: Visibility | null = null;
function defaultVisibility(): Visibility | null {
  if (typeof document === 'undefined') return null;
  sharedVisibility ??= documentVisibility();
  return sharedVisibility;
}

export function App({
  data = httpDataSource,
  statusFetch = defaultFetch,
  visibility = defaultVisibility(),
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
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [view, setView] = useState<'list' | 'map'>('list');
  const [clock, setClock] = useState(now);
  const wide = useMediaQuery(WIDE);
  const reducedMotion = useMemo(prefersReducedMotion, []);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const cache = useRef<EstimateCache>(new Map());
  const hintCache = useRef<HintCache>(new Map());

  const setSettings = useCallback(
    (next: Settings) => {
      setSettingsState(next);
      saveSettings(storage, next);
    },
    [storage],
  );

  // Live statuses start after the charger data, so they don't slow down the first useful render.
  const dataReady = Boolean(tariffs && regions[settings.region]);
  const [statusesStarted, setStatusesStarted] = useState(false);
  useEffect(() => {
    if (dataReady) setStatusesStarted(true);
  }, [dataReady]);
  const { statuses, error: statusError, pages: statusPages } = useStatuses(statusesStarted ? statusFetch : null, visibility);

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
  // Status pages hold 500 locations each, nationwide.
  const expectedPages = Math.max(1, Math.ceil((meta?.counts.locations ?? 3800) / 500));
  const regionLabel = meta?.regions[settings.region]?.label ?? settings.region;
  const countText = results ? `${count} ${count === 1 ? 'charger' : 'chargers'} found in ${regionLabel}.` : '';
  const announcement = useAnnouncement(countText, filterKey, announceDelayMs);

  const visible = results ? results.slice(0, shown) : [];
  const hintFor = (r: (typeof visible)[number]) => {
    if (!tariffs) return null;
    if (hintCache.current.size > 20_000) hintCache.current = new Map();
    return cheaperHint(r, tariffs, settings.energyKWh, start, hintCache.current);
  };
  const selectedResult = selectedId ? (results?.find((r) => r.charger.id === selectedId) ?? null) : null;
  const best: BestPick | null = !results
    ? null
    : statusError && !statuses
      ? {
          kind: 'none',
          reason: "Live availability is unavailable right now, so I can't tell which chargers are free. Prices below still work.",
          fix: null,
        }
      : pickBest(results, statuses !== null, { fastOnly: settings.fastOnly, connector: settings.connector });

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const showCard = useCallback(
    (id: string) => {
      if (results) {
        const index = results.findIndex((r) => r.charger.id === id);
        if (index >= shown) setShown(index + 1);
      }
      setExpanded((prev) => new Set(prev).add(id));
      setSelectedId(id);
      setView('list');
      // Wait a frame so the card exists and is expanded before moving to it.
      requestAnimationFrame(() => {
        const el = itemRefs.current.get(id);
        if (!el) return;
        el.scrollIntoView?.({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
        el.focus({ preventScroll: true });
      });
    },
    [results, shown, reducedMotion],
  );

  const applyFix = useCallback(
    (fix: 'fast' | 'connector') =>
      setSettings(fix === 'connector' ? { ...settings, connector: '' } : { ...settings, fastOnly: false }),
    [settings, setSettings],
  );

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
        el.scrollIntoView?.({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
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
        <nav className="viewswitch" aria-label="View">
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
            <ListIcon /> List
          </button>
          <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')}>
            <MapIcon /> Map
          </button>
        </nav>
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
          {statusError && (
            <p className="notice">
              Live availability unavailable right now. Prices are still shown, and I'll keep trying with longer waits.
            </p>
          )}
          {!results && !loadError && (
            <div className="skeletons">
              <p className="muted">Loading chargers…</p>
              <div className="skeleton skeleton-best" aria-hidden="true">
                <span className="sk sk-title" />
                <span className="sk sk-price" />
                <span className="sk sk-line" />
              </div>
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton" aria-hidden="true">
                  <span className="sk sk-title" />
                  <span className="sk sk-price" />
                  <span className="sk sk-line" />
                  <span className="sk sk-line sk-short" />
                </div>
              ))}
            </div>
          )}
          {results && best && (
            <BestCard
              pick={best}
              energyKWh={settings.energyKWh}
              startLabel={timeLabel(settings, clock)}
              hint={best.kind === 'best' ? hintFor(best.result) : null}
              progress={!statuses && !statusError && statusFetch ? { pages: statusPages, expected: expectedPages } : null}
              onShow={showCard}
              onFix={applyFix}
            />
          )}
          {results && (
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
          )}
          {results && (
            <>
              <p className="result-count muted">
                {count === 0 ? 'No chargers match.' : `Showing ${Math.min(shown, count)} of ${countText} ${distanceFrom}.`}
              </p>
              {count === 0 && (
                <div className="empty">
                  <p>Nothing matches these filters in {regionLabel}.</p>
                  <div className="empty-actions">
                    {settings.fastOnly && (
                      <button type="button" className="btn" onClick={() => applyFix('fast')}>
                        Turn off 'Fast only'
                      </button>
                    )}
                    {settings.connector && (
                      <button type="button" className="btn" onClick={() => applyFix('connector')}>
                        Use any connector
                      </button>
                    )}
                    {settings.region !== 'finland' && (
                      <button type="button" className="btn" onClick={() => setSettings({ ...settings, region: 'finland' })}>
                        Search all of Finland
                      </button>
                    )}
                  </div>
                </div>
              )}
              <ol className="results" aria-labelledby="results-heading">
                {visible.map((r) => (
                  <li key={r.charger.id}>
                    <ResultCard
                      ref={(el) => {
                        if (el) itemRefs.current.set(r.charger.id, el);
                        else itemRefs.current.delete(r.charger.id);
                      }}
                      result={r}
                      now={clock}
                      statusesLoaded={statuses !== null || statusError || !statusFetch}
                      selected={r.charger.id === selectedId}
                      highlighted={r.charger.id === highlightedId}
                      expanded={expanded.has(r.charger.id)}
                      hint={hintFor(r)}
                      onToggle={() => toggle(r.charger.id)}
                      onHighlight={setHighlightedId}
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
              <MapComponent
                results={visible}
                selectedId={selectedId}
                highlightedId={highlightedId}
                onSelect={onMarkerSelect}
                reducedMotion={reducedMotion}
                fitKey={filterKey}
                resetKey={settings.region}
              />
            </Suspense>
            {!wide && selectedResult && (
              <BottomCard
                result={selectedResult}
                onShowInList={() => showCard(selectedResult.charger.id)}
                onClose={() => setSelectedId(null)}
              />
            )}
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
