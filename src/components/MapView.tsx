import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useI18n, type Fmt } from '../i18n/index.tsx';
import { statusLabel } from '../i18n/present.ts';
import { groupPoints } from '../logic/grouping.ts';
import type { Result } from '../logic/results.ts';
import { availabilityKind, type AvailabilityKind } from '../logic/status.ts';

export interface MapViewProps {
  results: Result[];
  selectedId: string | null;
  highlightedId?: string | null;
  /** Cheapest free charger, drawn in blue. */
  bestId?: string | null;
  onSelect: (id: string) => void;
  reducedMotion: boolean;
  /** Changes when filters change; the map refits unless the user has moved it. */
  fitKey?: string;
  /** Changes when the region changes; the map forgets the user moved it. */
  resetKey?: string;
}

const GROUP_RADIUS = 36;

// CARTO's free raster tiles now need an API key, so this uses OSM tiles and mutes them in CSS (see .tiles-light and .tiles-dark).
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function isDark(): boolean {
  const forced = document.documentElement.dataset.theme;
  if (forced === 'dark') return true;
  if (forced === 'light') return false;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// Status dot: filled green or amber, grey ring for unknown, filled grey for offline.
function pinIcon(r: Result, selected: boolean, best: boolean, fmt: Fmt): L.DivIcon {
  const kind: AvailabilityKind = availabilityKind(r.availability);
  const price = r.cost.kind === 'estimate' ? fmt.pin(r.cost.min) : null;
  const cls = ['mp', `mp-${kind}`, best ? 'mp-best' : '', price ? '' : 'mp-bare', selected ? 'mp-selected' : '']
    .filter(Boolean)
    .join(' ');
  const html = `<span class="${cls}" aria-hidden="true"><i class="mp-dot"></i>${price ? `<b>${price}</b>` : ''}</span>`;
  return L.divIcon({ className: 'mp-wrap', html, iconSize: [0, 0] });
}

function groupIcon(n: number): L.DivIcon {
  return L.divIcon({ className: 'mp-wrap', html: `<span class="mg" aria-hidden="true">${n}</span>`, iconSize: [0, 0] });
}

export default function MapView({
  results,
  selectedId,
  highlightedId = null,
  bestId = null,
  onSelect,
  reducedMotion,
  fitKey = '',
  resetKey = '',
}: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const userMoved = useRef(false);
  const programmatic = useRef(false);
  const lastFit = useRef<string | null>(null);
  const { t, fmt } = useI18n();
  const state = useRef({ results, selectedId, highlightedId, bestId, t, fmt });
  state.current = { results, selectedId, highlightedId, bestId, t, fmt };
  const tiles = useRef<L.TileLayer | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const drawRef = useRef<() => void>(() => {});
  // Marker for each charger id; grouped chargers share their group's marker.
  const markerFor = useRef(new Map<string, L.Marker>());

  function applyHighlight(id: string | null): void {
    for (const marker of new Set(markerFor.current.values())) marker.getElement()?.firstElementChild?.classList.remove('mp-hl');
    const el = id ? markerFor.current.get(id)?.getElement()?.firstElementChild : null;
    el?.classList.add('mp-hl');
  }

  drawRef.current = () => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    markerFor.current.clear();
    const { results: rs, selectedId: sel, highlightedId: hl, bestId: bid, t: tt, fmt: ff } = state.current;
    const byId = new Map(rs.map((r) => [r.charger.id, r]));
    const points = rs.map((r) => {
      const p = m.latLngToContainerPoint([r.charger.lat, r.charger.lon]);
      return { id: r.charger.id, x: p.x, y: p.y };
    });
    const alone = new Set(sel ? [sel] : []);
    for (const group of groupPoints(points, GROUP_RADIUS, alone)) {
      if (group.ids.length === 1) {
        const r = byId.get(group.ids[0] ?? '');
        if (!r) continue;
        const id = r.charger.id;
        const price = r.cost.kind === 'estimate' ? `, ${ff.priceRange(r.cost.min, r.cost.max, r.cost.currency)}` : '';
        const marker = L.marker([r.charger.lat, r.charger.lon], {
          icon: pinIcon(r, id === sel, id === bid, ff),
          title: `${r.charger.name}: ${statusLabel(tt, r.availability)}${price}`,
          keyboard: false,
          zIndexOffset: id === sel ? 1000 : id === bid ? 500 : 0,
        });
        marker.on('click', () => onSelectRef.current(id));
        marker.addTo(g);
        markerFor.current.set(id, marker);
      } else {
        const members = group.ids.map((id) => byId.get(id)).filter((r): r is Result => Boolean(r));
        const bounds = L.latLngBounds(members.map((r) => [r.charger.lat, r.charger.lon] as [number, number]));
        const marker = L.marker(m.containerPointToLatLng([group.x, group.y]), {
          icon: groupIcon(members.length),
          title: tt.map.cluster(members.length),
          keyboard: false,
        });
        marker.on('click', () => {
          userMoved.current = true;
          m.fitBounds(bounds.pad(0.3), { maxZoom: Math.min(m.getZoom() + 3, 18), animate: !reducedMotion });
        });
        marker.addTo(g);
        for (const id of group.ids) markerFor.current.set(id, marker);
      }
    }
    applyHighlight(hl);
  };

  useEffect(() => {
    if (!container.current) return undefined;
    const m = L.map(container.current, {
      zoomAnimation: !reducedMotion,
      fadeAnimation: !reducedMotion,
      markerZoomAnimation: !reducedMotion,
      // Wheel zoom only after the map is clicked or focused, so scrolling the page doesn't get stuck on it.
      scrollWheelZoom: false,
      zoomControl: false,
      attributionControl: false,
    }).setView([65.0121, 25.4682], 12);
    m.on('focus click', () => m.scrollWheelZoom.enable());
    m.on('blur mouseout', () => m.scrollWheelZoom.disable());
    m.on('dragstart', () => {
      userMoved.current = true;
    });
    m.on('zoomstart', () => {
      if (!programmatic.current) userMoved.current = true;
    });
    m.on('moveend', () => {
      programmatic.current = false;
    });
    m.on('zoomend', () => drawRef.current());
    L.control.zoom({ position: 'bottomright', zoomInTitle: state.current.fmt.lang === 'fi' ? 'Lähennä' : 'Zoom in', zoomOutTitle: state.current.fmt.lang === 'fi' ? 'Loitonna' : 'Zoom out' }).addTo(m);
    L.control.attribution({ position: 'bottomleft', prefix: '<a href="https://leafletjs.com">Leaflet</a>' }).addTo(m);
    const addTiles = () => {
      tiles.current?.remove();
      tiles.current = L.tileLayer(TILE_URL, {
        maxZoom: 19,
        className: isDark() ? 'tiles-dark' : 'tiles-light',
        attribution: ATTRIBUTION,
      }).addTo(m);
    };
    addTiles();
    const scheme = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    scheme?.addEventListener('change', addTiles);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    // The pane can change size when it becomes visible.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => m.invalidateSize()) : null;
    ro?.observe(container.current);
    return () => {
      ro?.disconnect();
      scheme?.removeEventListener('change', addTiles);
      tiles.current = null;
      m.remove();
      map.current = null;
      layer.current = null;
      lastFit.current = null;
    };
  }, [reducedMotion]);

  useEffect(() => {
    userMoved.current = false;
  }, [resetKey]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (lastFit.current !== fitKey && results.length > 0) {
      lastFit.current = fitKey;
      if (!userMoved.current) {
        programmatic.current = true;
        const bounds = L.latLngBounds(results.map((r) => [r.charger.lat, r.charger.lon] as [number, number]));
        m.fitBounds(bounds, { padding: [32, 32], maxZoom: 15, animate: !reducedMotion });
      }
    }
    drawRef.current();
  }, [results, selectedId, bestId, fitKey, reducedMotion, t, fmt]);

  // Hover and focus only restyle the existing marker, so a pin never moves under the pointer.
  useEffect(() => {
    applyHighlight(highlightedId);
  }, [highlightedId]);

  useEffect(() => {
    const m = map.current;
    const r = state.current.results.find((x) => x.charger.id === selectedId);
    if (!m || !r) return;
    const ll = L.latLng(r.charger.lat, r.charger.lon);
    if (!m.getBounds().pad(-0.1).contains(ll)) {
      programmatic.current = true;
      m.panTo(ll, { animate: !reducedMotion });
    }
  }, [selectedId, reducedMotion]);

  return (
    <div
      ref={container}
      className="map"
      role="region"
      aria-label={t.map.label}
    />
  );
}
