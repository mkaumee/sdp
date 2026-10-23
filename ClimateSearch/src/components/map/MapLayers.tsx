// Map pieces shared by the Overview mini-map and the Map Explorer.
import { useEffect } from 'react';
import L from 'leaflet';
import { TileLayer, ImageOverlay, Rectangle, useMap } from 'react-leaflet';
import type { AreaInfo, MapOverlay } from '@/types';

export type Bounds = [[number, number], [number, number]];  // [[south, west], [north, east]]

// Same colour ramps the backend uses to paint the overlays (urban.py HEAT_COLOURS / VEG_COLOURS).
export const HEAT_GRADIENT = 'linear-gradient(to right, #45B881, #F4B942, #F05252)';
export const VEG_GRADIENT = 'linear-gradient(to right, #DFE7EF, #72C85B, #237A53)';

export function areaBounds(area: AreaInfo): Bounds {
  return [[area.bounds.south, area.bounds.west], [area.bounds.north, area.bounds.east]];
}

/** Esri satellite photos or the OpenStreetMap street map. */
export function BaseTiles({ source = 'satellite' }: { source?: 'satellite' | 'street' }) {
  return source === 'satellite' ? (
    <TileLayer
      url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
      maxZoom={18}
    />
  ) : (
    <TileLayer
      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      maxZoom={19}
    />
  );
}

/** Zooms the map to fit an area whenever the area changes. */
export function FitBounds({ bounds, padding = 10 }: { bounds: Bounds; padding?: number }) {
  const map = useMap();
  const key = bounds.flat().join(',');
  useEffect(() => {
    map.fitBounds(bounds, { padding: [padding, padding] });
  }, [map, key]);  // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** A satellite measurement painted over the map (temperature or vegetation PNG from the backend). */
export function DataOverlay({ overlay, opacity }: { overlay?: MapOverlay; opacity: number }) {
  if (!overlay) return null;
  return <ImageOverlay url={overlay.url} bounds={overlay.bounds} opacity={opacity} zIndex={300} />;
}

/** Dashed outline of the analysed area. */
export function AreaOutline({ area }: { area: AreaInfo }) {
  return (
    <Rectangle
      bounds={areaBounds(area)}
      pathOptions={{ color: '#B7E65C', weight: 1.5, dashArray: '6 6', fill: false }}
      interactive={false}
    />
  );
}

const TONES = {
  heat: { border: 'rgba(240, 82, 82, 0.6)', dot: '#F05252', text: '#FCA5A5' },
  warm: { border: 'rgba(244, 185, 66, 0.6)', dot: '#F4B942', text: '#FCD34D' },
  green: { border: 'rgba(183, 230, 92, 0.6)', dot: '#B7E65C', text: '#BEF264' },
};

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** A dark label pin like the dashboard design ("High Temperature Zone · 36.2°C"). */
export function pinIcon(tone: keyof typeof TONES, title: string, subtitle: string, pulse = false) {
  const t = TONES[tone];
  return L.divIcon({
    className: 'climate-pin',
    iconSize: undefined,
    iconAnchor: [12, 12],
    html: `<div style="display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:12px;border:1px solid ${t.border};
      background:rgba(13,27,42,0.88);color:#fff;white-space:nowrap;box-shadow:0 10px 25px rgba(0,0,0,0.45);backdrop-filter:blur(6px);cursor:pointer">
      <span style="position:relative;width:10px;height:10px;flex:none">
        ${pulse ? `<span class="climate-pin-ping" style="background:${t.dot}"></span>` : ''}
        <span style="position:absolute;inset:0;border-radius:9999px;background:${t.dot}"></span>
      </span>
      <span style="text-align:left;line-height:1.15">
        <span style="display:block;font-size:11px;font-weight:700">${escapeHtml(title)}</span>
        <span style="display:block;font-size:10px;font-weight:600;color:${t.text};margin-top:2px">${escapeHtml(subtitle)}</span>
      </span>
    </div>`,
  });
}
