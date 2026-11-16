import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Result } from '../logic/results.ts';

export interface MapViewProps {
  results: Result[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  reducedMotion: boolean;
}

type PinKind = 'yes' | 'no' | 'unknown';

function pinFor(r: Result): { kind: PinKind; label: string; text: string } {
  const a = r.availability;
  if (!a || a.total === a.unknown) return { kind: 'unknown', label: '?', text: 'live status unknown' };
  if (a.available > 0) return { kind: 'yes', label: String(a.available), text: `${a.available} of ${a.total} available` };
  return { kind: 'no', label: '0', text: `none of ${a.total} available` };
}

function icon(kind: PinKind, label: string, selected: boolean): L.DivIcon {
  // Shape and label carry the meaning as well as colour: circle = free, square = none free, diamond = unknown.
  return L.divIcon({
    className: '',
    html: `<span class="pin pin-${kind}${selected ? ' pin-selected' : ''}" aria-hidden="true"><span>${label}</span></span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

export default function MapView({ results, selectedId, onSelect, reducedMotion }: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<string, { marker: L.Marker; kind: PinKind; label: string }>());
  const lastIds = useRef('');
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

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
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      layer.current = null;
      markers.current.clear();
      lastIds.current = '';
    };
  }, [reducedMotion]);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    const seen = new Set<string>();
    for (const r of results) {
      const id = r.charger.id;
      seen.add(id);
      const { kind, label, text } = pinFor(r);
      const selected = id === selectedId;
      const existing = markers.current.get(id);
      const title = `${r.charger.name}: ${text}`;
      if (existing) {
        if (existing.kind !== kind || existing.label !== label) {
          existing.marker.setIcon(icon(kind, label, selected));
          existing.kind = kind;
          existing.label = label;
        }
        if (existing.marker.options.title !== title) {
          existing.marker.options.title = title;
          existing.marker.getElement()?.setAttribute('title', title);
        }
      } else {
        const marker = L.marker([r.charger.lat, r.charger.lon], { icon: icon(kind, label, selected), title, keyboard: false });
        marker.on('click', () => onSelectRef.current(id));
        marker.addTo(g);
        markers.current.set(id, { marker, kind, label });
      }
    }
    for (const [id, entry] of markers.current) {
      if (!seen.has(id)) {
        entry.marker.remove();
        markers.current.delete(id);
      }
    }
    // Refit only when the set of chargers changes, not on status updates.
    const ids = results.map((r) => r.charger.id).join(',');
    if (ids !== lastIds.current) {
      lastIds.current = ids;
      if (results.length > 0) {
        const bounds = L.latLngBounds(results.map((r) => [r.charger.lat, r.charger.lon] as [number, number]));
        m.fitBounds(bounds, { padding: [24, 24], maxZoom: 15, animate: !reducedMotion });
      }
    }
  }, [results, selectedId, reducedMotion]);

  useEffect(() => {
    for (const [id, entry] of markers.current) {
      entry.marker.setIcon(icon(entry.kind, entry.label, id === selectedId));
      entry.marker.setZIndexOffset(id === selectedId ? 1000 : 0);
    }
    const sel = selectedId ? markers.current.get(selectedId) : undefined;
    if (sel && map.current) map.current.panTo(sel.marker.getLatLng(), { animate: !reducedMotion });
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
