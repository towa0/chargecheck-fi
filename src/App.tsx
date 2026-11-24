import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { ChargeBar } from './components/ChargeBar.tsx';
import { Header } from './components/Header.tsx';
import { BestCard } from './components/BestCard.tsx';
import { BottomSheet, type SheetState } from './components/BottomSheet.tsx';
import { ResultCard } from './components/ResultCard.tsx';
import { formatBuilt } from './i18n/format.ts';
import { I18nProvider, loadLang, saveLang, useI18n, type Lang } from './i18n/index.tsx';
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
import { loadSettings, resolveStart, saveSettings, type Settings } from './logic/settings.ts';
import { availabilityKind } from './logic/status.ts';

const PAGE_SIZE = 50;
const REPO_URL = 'https://github.com/towa0/chargecheck-fi';
const WIDE = '(min-width: 48em)';
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
  /** Start language. Defaults to the saved choice, then Finnish. */
  lang?: Lang;
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

export function App(props: AppProps) {
  const storage = props.storage === undefined ? defaultStorage() : props.storage;
  const [lang, setLangState] = useState<Lang>(() => props.lang ?? loadLang(storage));
  const setLang = useCallback(
    (next: Lang) => {
      setLangState(next);
      saveLang(storage, next);
    },
    [storage],
  );
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return (
    <I18nProvider lang={lang}>
      <Shell {...props} storage={storage} onLang={setLang} />
    </I18nProvider>
  );
}

function Shell({
  onLang,
  data = httpDataSource,
  statusFetch = defaultFetch,
  visibility = defaultVisibility(),
  now = Date.now,
  mapView = LazyMap,
  announceDelayMs = 1000,
  geolocation = typeof navigator !== 'undefined' && 'geolocation' in navigator ? navigator.geolocation : null,
  storage = defaultStorage(),
}: AppProps & { onLang: (lang: Lang) => void }) {
  const { t } = useI18n();
  const [settings, setSettingsState] = useState<Settings>(() => loadSettings(storage));
  const [meta, setMeta] = useState<Meta | null>(null);
  const [tariffs, setTariffs] = useState<TariffFile | null>(null);
  const [regions, setRegions] = useState<Record<string, RegionFile>>({});
  const [loadError, setLoadError] = useState(false);
  const [point, setPoint] = useState<Point>(DEFAULT_POINT);
  const [pointIsUser, setPointIsUser] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [sheet, setSheet] = useState<SheetState>('peek');
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
  const { statuses, error: statusError } = useStatuses(statusesStarted ? statusFetch : null, visibility);

  useEffect(() => {
    let cancelled = false;
    Promise.all([data.meta(), data.tariffs()])
      .then(([m, t]) => {
        if (cancelled) return;
        setMeta(m);
        setTariffs(t);
      })
      .catch(() => !cancelled && setLoadError(true));
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
      .catch(() => !cancelled && setLoadError(true));
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
  const regionLabel = t.regions[settings.region] ?? meta?.regions[settings.region]?.label ?? settings.region;
  const countText = results ? t.list.found(count, regionLabel) : '';
  const announcement = useAnnouncement(countText, filterKey, announceDelayMs);

  const visible = results ? results.slice(0, shown) : [];
  const hintFor = (r: (typeof visible)[number]) => {
    if (!tariffs) return null;
    if (hintCache.current.size > 20_000) hintCache.current = new Map();
    return cheaperHint(r, tariffs, settings.energyKWh, start, hintCache.current);
  };
  const liveUnavailable = Boolean(statusError && !statuses);
  const best: BestPick | null = !results
    ? null
    : liveUnavailable
      ? { kind: 'none', reason: '', fix: null }
      : pickBest(results, statuses !== null, { fastOnly: settings.fastOnly, connector: settings.connector });
  const noneKind: 'empty' | 'nofree' | 'noprice' | 'unavailable' = liveUnavailable
    ? 'unavailable'
    : !results || results.length === 0
      ? 'empty'
      : results.some((r) => availabilityKind(r.availability) === 'free')
        ? 'noprice'
        : 'nofree';
  const bestId = best?.kind === 'best' ? best.result.charger.id : null;

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
      if (!wide) setSheet('full');
      // Wait a frame so the card exists and is expanded before moving to it.
      requestAnimationFrame(() => {
        const el = itemRefs.current.get(id);
        if (!el) return;
        el.scrollIntoView?.({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
        el.focus({ preventScroll: true });
      });
    },
    [results, shown, reducedMotion, wide],
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
      if (!wide) setSheet((cur) => (cur === 'peek' ? 'half' : cur));
      // Wait a frame so the sheet has its new height before the row scrolls into view.
      requestAnimationFrame(() => {
        const el = itemRefs.current.get(id);
        if (!el) return;
        el.scrollIntoView?.({ behavior: reducedMotion ? 'auto' : 'smooth', block: wide ? 'center' : 'start' });
        el.focus({ preventScroll: true });
      });
    },
    [reducedMotion, wide],
  );

  const distanceFrom = locationError ? t.list.distFailed : pointIsUser ? t.list.distFromMe : t.list.distFromCentre;

  const MapComponent = mapView;
  const useSheet = Boolean(MapComponent) && !wide;
  const waitingStatuses = !statuses && !statusError && Boolean(statusFetch);

  const pane = (
    <main className="results-pane" id="results" tabIndex={-1}>
      {loadError && (
        <p className="notice notice-error" role="alert">
          {t.states.loadError}
        </p>
      )}
      {statusError && <p className="notice">{t.states.statusError}</p>}
      {!results && !loadError && (
        <div className="list-skeleton">
          <span className="visually-hidden">{t.list.loading}</span>
          <div className="hero hero-skeleton" aria-hidden="true">
            <span className="sk sk-hero-label" />
            <span className="sk sk-hero-name" />
            <span className="sk sk-hero-price" />
            <span className="sk sk-hero-line" />
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="row row-skeleton" aria-hidden="true">
              <span className="sk sk-row-title" />
              <span className="sk sk-row-price" />
              <span className="sk sk-row-meta" />
            </div>
          ))}
        </div>
      )}
      {results && best && (
        <BestCard
          pick={waitingStatuses && best.kind !== 'best' ? { kind: 'waiting' } : best}
          energyKWh={settings.energyKWh}
          hint={best.kind === 'best' ? hintFor(best.result) : null}
          onShow={showCard}
          onFix={applyFix}
          noneKind={noneKind}
          filters={{ fastOnly: settings.fastOnly, connector: settings.connector }}
        />
      )}
      {results && (
        <>
          <div className="results-head">
            <h2 id="results-heading" className="results-title">
              {t.list.title}
            </h2>
            <div className="sort">
              <label htmlFor="sort">{t.list.sort}</label>
              <select
                id="sort"
                className="select select-sm"
                value={settings.sort}
                onChange={(e) => setSettings({ ...settings, sort: e.target.value as SortKey })}
              >
                <option value="cost">{t.list.sortCost}</option>
                <option value="distance">{t.list.sortDistance}</option>
                <option value="power">{t.list.sortPower}</option>
              </select>
            </div>
          </div>
          <p className="result-count">
            {count === 0 ? '' : `${t.list.showing(Math.min(shown, count), count)} · ${distanceFrom}`}
          </p>
          <p className="visually-hidden">{countText}</p>
          {count === 0 && (
            <div className="empty">
              <p className="empty-title">{t.states.emptyTitle(regionLabel)}</p>
              <p className="muted">{t.states.emptyBody}</p>
              <div className="empty-actions">
                {settings.fastOnly && (
                  <button type="button" className="btn" onClick={() => applyFix('fast')}>
                    {t.hero.turnOffFast}
                  </button>
                )}
                {settings.connector && (
                  <button type="button" className="btn" onClick={() => applyFix('connector')}>
                    {t.hero.useAnyConnector}
                  </button>
                )}
                {settings.region !== 'finland' && (
                  <button type="button" className="btn" onClick={() => setSettings({ ...settings, region: 'finland' })}>
                    {t.states.searchAll}
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
            <button type="button" className="btn btn-more" onClick={() => setShown((n) => n + PAGE_SIZE)}>
              {t.list.more(Math.min(PAGE_SIZE, count - shown))}
            </button>
          )}
        </>
      )}
      <Footer meta={meta} />
    </main>
  );

  return (
    <div className="app" data-sheet={useSheet ? sheet : undefined}>
      <a className="skip-link" href="#results">
        {t.skip}
      </a>
      <Header
        region={settings.region}
        onRegion={(id) => setSettings({ ...settings, region: id })}
        onUseLocation={geolocation ? onUseLocation : null}
        locating={locating}
        usingLocation={pointIsUser}
        onLang={onLang}
      />
      <h1 className="visually-hidden">{t.appTitle}</h1>
      <ChargeBar settings={settings} onChange={setSettings} now={clock} />

      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <div className={useSheet ? 'split split-sheet' : 'split'}>
        {useSheet ? (
          <BottomSheet state={sheet} onState={setSheet}>
            {pane}
          </BottomSheet>
        ) : (
          pane
        )}
        {MapComponent && (
          <section className="map-pane" aria-label={t.map.label}>
            <Suspense fallback={<p className="map-loading">{t.map.loading}</p>}>
              <MapComponent
                results={visible}
                selectedId={selectedId}
                highlightedId={highlightedId}
                bestId={bestId}
                onSelect={onMarkerSelect}
                reducedMotion={reducedMotion}
                fitKey={filterKey}
                resetKey={settings.region}
              />
            </Suspense>
          </section>
        )}
      </div>
    </div>
  );
}

function Footer({ meta }: { meta: Meta | null }) {
  const { t, lang } = useI18n();
  return (
    <footer className="site-footer">
      <p>
        Data: <a href="https://www.digitraffic.fi/">Fintraffic / digitraffic.fi</a>,{' '}
        <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.
      </p>
      <p>{t.footer.estimates}</p>
      <p>
        {meta && (
          <>
            {t.footer.built} <time dateTime={meta.builtAt}>{formatBuilt(lang, meta.builtAt)}</time>.{' '}
          </>
        )}
        {t.footer.notAffiliated} <a href={REPO_URL}>{t.footer.source}</a>
      </p>
    </footer>
  );
}
