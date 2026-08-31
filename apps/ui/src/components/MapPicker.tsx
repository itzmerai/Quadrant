import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { BBox, Territory } from '@quadrant/core';
import { bboxFromCorners, territoryHex } from '@quadrant/core';

interface Props {
  territories: Territory[];
  selectedId: string | null;
  drawing: boolean;
  onDrawn: (bbox: BBox) => void;
  onSelect: (id: string) => void;
  /** Height as a percentage of the main pane, driven by the resize handle. */
  heightPct: number;
  theme: 'light' | 'dark';
  onClose: () => void;
}

const STYLE_DRAFT: L.PathOptions = {
  color: '#1F5FD0', weight: 2, dashArray: '6 4', fillColor: '#1F5FD0', fillOpacity: 0.1,
};


const OSM_ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * Standard OpenStreetMap tiles, dark-themed with a CSS filter.
 *
 * Third-party "free" basemaps did not survive contact: Stadia returns 401
 * without a key, and CARTO returns HTTP 200 but stamps every tile with
 * "API KEY REQUIRED". A status-code probe cannot tell those apart from real
 * keyless access — only looking at the rendered tile can.
 *
 * OSM's own tiles are the one source this app has actually run against for
 * real, so the dark variant is produced locally (see `.theme-dark .map-canvas`
 * in layout.css) rather than by trusting another provider's free tier.
 */
function makeTileLayer(): L.TileLayer {
  return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: OSM_ATTRIB,
  });
}

export function MapPicker({ territories, selectedId, drawing, onDrawn, onSelect, heightPct, theme, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const draftRef = useRef<L.Rectangle | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);

  // Latest values, readable from Leaflet handlers bound once.
  const drawingRef = useRef(drawing);
  const onDrawnRef = useRef(onDrawn);
  drawingRef.current = drawing;
  onDrawnRef.current = onDrawn;

  /* --- create the map once --- */
  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;

    const map = L.map(hostRef.current, {
      center: [33.55, -111.92],
      zoom: 11,
      zoomControl: true,
      attributionControl: true,
    });

    tileRef.current = makeTileLayer().addTo(map);

    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // Point and drag to draw a rectangle. Native Leaflet events, so there is
    // no plugin to keep in sync with Leaflet releases.
    let origin: L.LatLng | null = null;

    const clearDraft = () => {
      if (draftRef.current) {
        draftRef.current.remove();
        draftRef.current = null;
      }
    };

    map.on('mousedown', (e: L.LeafletMouseEvent) => {
      if (!drawingRef.current) return;
      origin = e.latlng;
      clearDraft();
      draftRef.current = L.rectangle(L.latLngBounds(origin, origin), STYLE_DRAFT).addTo(map);
    });

    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (!drawingRef.current || !origin || !draftRef.current) return;
      draftRef.current.setBounds(L.latLngBounds(origin, e.latlng));
    });

    map.on('mouseup', (e: L.LeafletMouseEvent) => {
      if (!drawingRef.current || !origin) return;
      const start = origin;
      origin = null;

      // A click without a drag is not a box.
      const box = bboxFromCorners([start.lat, start.lng], [e.latlng.lat, e.latlng.lng]);
      const tiny = box.north - box.south < 0.002 || box.east - box.west < 0.002;
      clearDraft();
      if (tiny) return;

      onDrawnRef.current(box);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  /* --- height changes need Leaflet told, or tiles render against stale size --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const id = window.setTimeout(() => map.invalidateSize(), 60);
    return () => window.clearTimeout(id);
  }, [heightPct]);

  /* --- draw mode toggles map panning and the cursor --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (drawing) {
      map.dragging.disable();
      map.getContainer().style.cursor = 'crosshair';
    } else {
      map.dragging.enable();
      map.getContainer().style.cursor = '';
      if (draftRef.current) {
        draftRef.current.remove();
        draftRef.current = null;
      }
    }
  }, [drawing]);

  /* --- render saved boxes --- */
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    for (const t of territories) {
      const bounds = L.latLngBounds(
        [t.bbox.south, t.bbox.west],
        [t.bbox.north, t.bbox.east],
      );
      const selected = t.id === selectedId;
      const hex = territoryHex(t.color, theme);
      // Selection reads as weight and fill, so the hue stays the box's identity.
      const rect = L.rectangle(bounds, {
        color: hex,
        weight: selected ? 3 : theme === 'dark' ? 2 : 1.5,
        fillColor: hex,
        fillOpacity: selected ? 0.18 : 0.07,
      });
      rect.on('click', () => onSelect(t.id));
      rect.bindTooltip(t.name + ' · ' + t.leadCount + ' leads', {
        permanent: false,
        direction: 'top',
      });
      layer.addLayer(rect);
    }
  }, [territories, selectedId, onSelect, theme]);

  /* --- fly to the selected box --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const t = territories.find((x) => x.id === selectedId);
    if (!t) return;
    map.flyToBounds(
      L.latLngBounds([t.bbox.south, t.bbox.west], [t.bbox.north, t.bbox.east]),
      { padding: [48, 48], duration: 0.6 },
    );
  }, [selectedId]);

  /** Contiguous US, so a lost user can always get back to usable ground. */
  function goHome() {
    mapRef.current?.flyToBounds(
      L.latLngBounds([24.5, -125.0], [49.4, -66.9]),
      { padding: [24, 24], duration: 0.7 },
    );
  }

  return (
    <div className={'map-host theme-' + theme} style={{ height: heightPct + '%' }}>
      <div ref={hostRef} className="map-canvas" />
      {drawing && (
        <div className="map-hint" role="status">
          <strong>Press and drag</strong> to draw your box — over a US city, since
          the provider registry is US-only
        </div>
      )}
      <div className="map-controls">
        <button className="map-btn" onClick={goHome} title="Jump back to the United States">
          Show US
        </button>
        <button className="map-btn" onClick={onClose} title="Hide the map and give the space to the lead list">
          Hide map
        </button>
      </div>
    </div>
  );
}
