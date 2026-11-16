import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { groupPoints, pinPrice } from '../logic/grouping.ts';
import type { Result } from '../logic/results.ts';
import { availabilityKind, availabilityText, type AvailabilityKind } from '../logic/status.ts';

export interface MapViewProps {
  results: Result[];
  selectedId: string | null;
  highlightedId?: string | null;
  onSelect: (id: string) => void;
  reducedMotion: boolean;
  /** Changes when filters change; the map refits unless the user has moved it. */
  fitKey?: string;
  /** Changes when the region changes; the map forgets the user moved it. */
  resetKey?: string;
}

const GROUP_RADIUS = 30;

// Shape keeps the meaning without colour: circle = free, square = none free, diamond = no live status.
function shapeClass(kind: AvailabilityKind): string {
  if (kind === 'free') return 'mp-free';
  if (kind === 'unknown') return 'mp-unknown';
  return kind === 'busy' ? 'mp-busy' : 'mp-down';
}

function pinIcon(r: Result, selected: boolean, highlighted: boolean): L.DivIcon {
  const kind = availabilityKind(r.availability);
  const price = r.cost.kind === 'estimate' ? pinPrice(r.cost.min, r.cost.currency) : null;
  const cls = ['mp', shapeClass(kind), price ? '' : 'mp-dot', selected ? 'mp-selected' : '', highlighted ? 'mp-hl' : '']
    .filter(Boolean)
    .join(' ');
  const html = `<span class="${cls}" aria-hidden="true"><i class="mp-shape"></i>${price ? `<b>${price}</b>` : ''}</span>`;
  const w = price ? 22 + price.length * 9 : 22;
  const size = selected ? 1.15 : 1;
  return L.divIcon({ className: 'mp-wrap', html, iconSize: [w * size, 26 * size], iconAnchor: [(w * size) / 2, 13 * size] });
}

function groupIcon(n: number): L.DivIcon {
  return L.divIcon({
    className: 'mp-wrap',
    html: `<span class="mg" aria-hidden="true">${n}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

export default function MapView({
  results,
  selectedId,
  highlightedId = null,
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
  const state = useRef({ results, selectedId, highlightedId });
  state.current = { results, selectedId, highlightedId };
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
    const { results: rs, selectedId: sel, highlightedId: hl } = state.current;
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
        const price = r.cost.kind === 'estimate' ? `, estimated ${pinPrice(r.cost.min, r.cost.currency)}` : '';
        const marker = L.marker([r.charger.lat, r.charger.lon], {
          icon: pinIcon(r, id === sel, false),
          title: `${r.charger.name}: ${availabilityText(r.availability)}${price}`,
          keyboard: false,
          zIndexOffset: id === sel ? 1000 : 0,
        });
        marker.on('click', () => onSelectRef.current(id));
        marker.addTo(g);
        markerFor.current.set(id, marker);
      } else {
        const members = group.ids.map((id) => byId.get(id)).filter((r): r is Result => Boolean(r));
        const bounds = L.latLngBounds(members.map((r) => [r.charger.lat, r.charger.lon] as [number, number]));
        const marker = L.marker(m.containerPointToLatLng([group.x, group.y]), {
          icon: groupIcon(members.length),
          title: `${members.length} chargers here. Click to zoom in.`,
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
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    // The pane can change size when it becomes visible.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => m.invalidateSize()) : null;
    ro?.observe(container.current);
    return () => {
      ro?.disconnect();
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
  }, [results, selectedId, fitKey, reducedMotion]);

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
      aria-label="Map of the chargers in the list. The list has the same information."
    />
  );
}
