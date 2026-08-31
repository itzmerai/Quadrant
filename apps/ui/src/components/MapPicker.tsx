import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { BBox, Territory } from '@quadrant/core';
import { bboxFromCorners } from '@quadrant/core';

interface Props {
  territories: Territory[];
  selectedId: string | null;
  drawing: boolean;
  onDrawn: (bbox: BBox) => void;
  onSelect: (id: string) => void;
}

const STYLE_IDLE: L.PathOptions = {
  color: '#5B7FC7', weight: 1.5, fillColor: '#5B7FC7', fillOpacity: 0.06,
};
const STYLE_SELECTED: L.PathOptions = {
  color: '#1F5FD0', weight: 2.5, fillColor: '#1F5FD0', fillOpacity: 0.12,
};
const STYLE_DRAFT: L.PathOptions = {
  color: '#1F5FD0', weight: 2, dashArray: '6 4', fillColor: '#1F5FD0', fillOpacity: 0.1,
};

export function MapPicker({ territories, selectedId, drawing, onDrawn, onSelect }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const draftRef = useRef<L.Rectangle | null>(null);

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

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

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
      const rect = L.rectangle(bounds, selected ? STYLE_SELECTED : STYLE_IDLE);
      rect.on('click', () => onSelect(t.id));
      rect.bindTooltip(t.name + ' · ' + t.leadCount + ' leads', {
        permanent: false,
        direction: 'top',
      });
      layer.addLayer(rect);
    }
  }, [territories, selectedId, onSelect]);

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
    <div className="map-host">
      <div ref={hostRef} className="map-canvas" />
      {drawing && (
        <div className="map-hint" role="status">
          <strong>Press and drag</strong> to draw your box — over a US city, since
          the provider registry is US-only
        </div>
      )}
      <button className="map-home" onClick={goHome} title="Jump back to the United States">
        Show US
      </button>
    </div>
  );
}
