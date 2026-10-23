import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapContainer, CircleMarker, Popup, Rectangle, Tooltip, useMap, useMapEvents, ZoomControl
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import toast from 'react-hot-toast';
import {
  Search, X, Layers, RotateCcw, MapPin,
  Thermometer, Leaf, Flame, Eye, EyeOff,
  Navigation, Sparkles, Crosshair, Satellite
} from 'lucide-react';
import { useAppStore } from '@/store';
import { api, type PlaceResult } from '@/services/api';
import { AreaGate } from '@/components/ui/AreaGate';
import { AreaOutline, BaseTiles, DataOverlay, HEAT_GRADIENT, VEG_GRADIENT } from '@/components/map/MapLayers';
import { cn, formatTemp, formatDate, formatCoords } from '@/lib/utils';
import type { AreaCell, AreaData, ClimateZone, GreeningCandidate, Hotspot, LatLng, Severity } from '@/types';

// Map view controller component to handle programmatic pan/zoom
function MapController({ center, zoom }: { center: LatLng; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([center.lat, center.lng], zoom, { duration: 1.2 });
  }, [center, zoom, map]);
  return null;
}

// Reports the pointer position, zoom and clicks back to the page
function MapEvents({ onMove, onZoom, onClick }: {
  onMove: (c: LatLng) => void; onZoom: (z: number) => void; onClick: (c: LatLng) => void;
}) {
  useMapEvents({
    mousemove: e => onMove({ lat: e.latlng.lat, lng: e.latlng.lng }),
    zoomend: e => onZoom(e.target.getZoom()),
    click: e => onClick({ lat: e.latlng.lat, lng: e.latlng.lng }),
  });
  return null;
}

// One row of the search dropdown
interface SearchItem {
  id: string;
  name: string;
  category: 'Zone' | 'Hotspot' | 'Greening Candidate' | 'Place' | 'Coordinates';
  coords: LatLng;
  temp?: number | null;
  veg?: number;
  detail?: string;
  open: () => void;
}

// What the Location Intel drawer shows
interface Intel {
  title: string;
  type: 'hotspot' | 'greening' | 'zone' | 'cell' | 'outside';
  coords: LatLng;
  temp: number | null;
  veg: number | null;
  severity: Severity | null;
  details: string;
  actions: string[];
  facts?: string[];
}

const AREA_WIDTHS = [5, 10, 15, 20];  // km options for the analysis area

/** "3.15, 101.6" -> coordinates (or null). */
function parseCoords(text: string): LatLng | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

function hotspotIntel(hs: Hotspot): Intel {
  return {
    title: hs.name, type: 'hotspot', coords: hs.coordinates, temp: hs.surfaceTemp, veg: hs.vegetationCoverage,
    severity: hs.severity, details: hs.contributing_factors.join('; '), actions: hs.mitigation_suggestions,
    facts: [`${hs.area ?? '–'} km² · priority ${hs.priorityScore}/100`, hs.people ? `${hs.people.toLocaleString()} residents` : ''],
  };
}

function candidateIntel(gc: GreeningCandidate): Intel {
  return {
    title: gc.name, type: 'greening', coords: gc.coordinates, temp: gc.surfaceTemp, veg: gc.currentVegetation,
    severity: gc.severity, details: gc.reasoning, actions: [gc.recommendedAction],
    facts: [`${gc.candidateArea} ha candidate area`, gc.interventionType ?? ''],
  };
}

function zoneIntel(z: ClimateZone): Intel {
  return {
    title: z.name, type: 'zone', coords: z.coordinates, temp: z.surfaceTemp, veg: z.vegetationCoverage,
    severity: z.severity,
    details: `${z.location}: ${z.builtPct ?? '–'}% built-up, ${z.treePct ?? '–'}% tree cover, `
      + `${z.people != null ? `about ${z.people.toLocaleString()} residents` : 'population unknown'}. Priority ${z.priorityScore}/100.`,
    actions: z.severity === 'high'
      ? ['Target for street trees and shade', 'Check rooftops for cool-roof coatings', 'Protect remaining green cover']
      : z.severity === 'medium'
        ? ['Plant along streets with the least shade', 'Keep existing green cover connected']
        : ['Protect existing vegetation', 'Monitor for new development'],
  };
}

function cellIntel(c: AreaCell, data: AreaData): Intel {
  const hot = data.thresholds.hotspot !== null && c.surfaceTemp !== null && c.surfaceTemp >= data.thresholds.hotspot;
  return {
    title: `Grid cell ${String.fromCharCode(65 + c.col)}${c.row + 1}`, type: 'cell', coords: c.center,
    temp: c.surfaceTemp, veg: c.vegetationCoverage, severity: c.severity,
    details: `Mostly ${c.mainCover}: ${c.builtPct}% built-up, ${c.treePct}% trees, ${c.barePct}% bare ground, `
      + `${c.waterPct}% water${c.people != null ? `, about ${c.people.toLocaleString()} residents` : ''}. `
      + (hot ? `Hotter than the hotspot threshold (${formatTemp(data.thresholds.hotspot)}).` : 'Below the hotspot threshold.'),
    actions: c.openPct >= 10 && c.vegetationCoverage < 40
      ? [`${c.openPct}% open ground could take new trees`, 'Shade streets and parking areas']
      : c.vegetationCoverage >= 60 ? ['Protect this green cover — it cools its surroundings'] : ['Consider cool roofs and street trees'],
    facts: [`NDVI ${c.ndvi ?? 'n/a'}`, `Priority ${c.priorityScore}/100`],
  };
}

export default function MapExplorerPage() {
  return <AreaGate>{data => <MapExplorer data={data} />}</AreaGate>;
}

function MapExplorer({ data }: { data: AreaData }) {
  const {
    mapCenter, mapZoom, setMapView,
    mapLayers, toggleLayer, setLayerOpacity,
    selectedZone, setSelectedZone,
    setSelectedHotspot, setSelectedCandidate,
    setChatContext, setChatVisible, area: selection, setArea, baseMap,
  } = useAppStore();
  const { area, provenance, zones, hotspots, greeningCandidates, cells, overlays } = data;

  const [searchQuery, setSearchQuery] = useState('');
  const [places, setPlaces] = useState<PlaceResult[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<Intel | null>(null);
  const [tileSource, setTileSource] = useState<'satellite' | 'street'>(baseMap);
  const [showLayerPanel, setShowLayerPanel] = useState(true);
  const [currentCoords, setCurrentCoords] = useState<LatLng>(area.coordinates);
  const [zoom, setZoom] = useState(mapZoom);
  const [widthKm, setWidthKm] = useState(selection.widthKm);

  // Coming from the Overview's zone table: open that zone straight away
  useEffect(() => {
    if (selectedZone) {
      setSelectedEntity(zoneIntel(selectedZone));
      setSelectedZone(null);
    }
  }, [selectedZone, setSelectedZone]);

  const analyse = (coords: LatLng, name?: string, location?: string, width = widthKm) => {
    setArea({ lat: coords.lat, lng: coords.lng, widthKm: width, name, location });
    toast(`Analysing ${name ?? formatCoords(coords.lat, coords.lng, 3)}…`, { icon: '🛰️' });
  };

  const focus = (intel: Intel, zoomLevel = 15) => {
    setMapView(intel.coords, zoomLevel);
    setCurrentCoords(intel.coords);
    setSelectedEntity(intel);
  };

  // Things already on the map that match the search text
  const localResults = useMemo<SearchItem[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const items: SearchItem[] = [
      ...zones.map(z => ({ id: z.id, name: z.name, category: 'Zone' as const, coords: z.coordinates, temp: z.surfaceTemp, veg: z.vegetationCoverage, open: () => focus(zoneIntel(z), 14) })),
      ...hotspots.map(h => ({ id: h.id, name: h.name, category: 'Hotspot' as const, coords: h.coordinates, temp: h.surfaceTemp, veg: h.vegetationCoverage, open: () => { setSelectedHotspot(h); focus(hotspotIntel(h)); } })),
      ...greeningCandidates.map(g => ({ id: g.id, name: g.name, category: 'Greening Candidate' as const, coords: g.coordinates, temp: g.surfaceTemp, veg: g.currentVegetation, open: () => { setSelectedCandidate(g); focus(candidateIntel(g)); } })),
    ];
    return items.filter(i => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)).slice(0, 4);
  }, [searchQuery, data]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Places anywhere in the world (OpenStreetMap), looked up after a short pause in typing
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 3 || parseCoords(q)) {
      setPlaces([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.searchPlaces(q).then(found => !cancelled && setPlaces(found.slice(0, 4))).catch(() => !cancelled && setPlaces([]));
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [searchQuery]);

  const typedCoords = parseCoords(searchQuery);
  const searchResults: SearchItem[] = [
    ...(typedCoords ? [{
      id: 'coords', name: formatCoords(typedCoords.lat, typedCoords.lng), category: 'Coordinates' as const, coords: typedCoords,
      detail: 'Analyse this point', open: () => analyse(typedCoords),
    }] : []),
    ...localResults,
    ...places.map((p, i) => ({
      id: `place-${i}`, name: p.name, category: 'Place' as const, coords: { lat: p.lat, lng: p.lon }, detail: p.detail,
      open: () => analyse({ lat: p.lat, lng: p.lon }, p.name, p.detail),
    })),
  ];

  const handleSelectSearchResult = (item: SearchItem) => {
    setSearchQuery('');
    setPlaces([]);
    item.open();
  };

  const handleMapClick = (c: LatLng) => {
    setCurrentCoords(c);
    const b = area.bounds;
    if (c.lat > b.north || c.lat < b.south || c.lng > b.east || c.lng < b.west) {
      setSelectedEntity({
        title: 'Outside the analysed area', type: 'outside', coords: c, temp: null, veg: null, severity: null,
        details: `This point is outside the ${area.widthKm} km area around ${area.name}. Analyse it to load its satellite data.`,
        actions: [],
      });
      return;
    }
    const cell = cells.find(x => c.lat >= x.bounds[0][0] && c.lat <= x.bounds[1][0] && c.lng >= x.bounds[0][1] && c.lng <= x.bounds[1][1]);
    if (cell) setSelectedEntity(cellIntel(cell, data));
  };

  const handleResetView = () => {
    setMapView({ ...area.coordinates }, 13);
    setCurrentCoords(area.coordinates);
    setSelectedEntity(null);
  };

  const askAssistantAboutLocation = () => {
    if (!selectedEntity) return;
    setChatContext({
      selectedLocation: selectedEntity.title,
      selectedCoordinates: selectedEntity.coords,
      selectedHotspot: selectedEntity.type === 'hotspot' ? selectedEntity.title : undefined,
      selectedCandidate: selectedEntity.type === 'greening' ? selectedEntity.title : undefined,
      route: '/map-explorer',
    });
    setChatVisible(true);
  };

  // Check layer states
  const layer = (id: string) => mapLayers.find(l => l.id === id);
  const isBaseActive = layer('satellite')?.enabled ?? true;
  const isHeatActive = layer('temperature')?.enabled ?? true;
  const isVegActive = layer('vegetation')?.enabled ?? false;
  const isHotspotActive = layer('hotspots')?.enabled ?? true;
  const isGreenspaceActive = layer('greenspaces')?.enabled ?? false;
  const isBoundaryActive = layer('boundaries')?.enabled ?? false;
  const legend = isHeatActive || !isVegActive ? overlays.temperature : overlays.vegetation;
  const greenCells = cells.filter(c => c.vegetationCoverage >= 60);

  return (
    <div className="relative w-full h-[calc(100vh-61px)] overflow-hidden flex">
      {/* Map Area */}
      <div className="flex-1 relative h-full w-full">
        <MapContainer
          center={[area.coordinates.lat, area.coordinates.lng]}
          zoom={13}
          zoomControl={false}
          style={{ height: '100%', width: '100%', background: '#07111F' }}
        >
          <ZoomControl position="bottomright" />
          <MapController center={mapCenter} zoom={mapZoom} />
          <MapEvents onMove={setCurrentCoords} onZoom={setZoom} onClick={handleMapClick} />

          {/* Base Tiles: Satellite vs Street */}
          {isBaseActive && <BaseTiles source={tileSource} />}

          {/* Measured layers from the satellites */}
          {isHeatActive && <DataOverlay overlay={overlays.temperature} opacity={layer('temperature')?.opacity ?? 0.7} />}
          {isVegActive && <DataOverlay overlay={overlays.vegetation} opacity={layer('vegetation')?.opacity ?? 0.7} />}
          <AreaOutline area={area} />

          {/* 3 x 3 analysis zones */}
          {isBoundaryActive && zones.map(z => z.bounds && (
            <Rectangle
              key={z.id}
              bounds={z.bounds}
              pathOptions={{ color: '#DFE7EF', weight: 1, opacity: layer('boundaries')?.opacity ?? 0.5, fillOpacity: 0.02 }}
              bubblingMouseEvents={false}
              eventHandlers={{ click: () => focus(zoneIntel(z), 14) }}
            >
              <Tooltip direction="center" permanent className="!bg-transparent !border-0 !shadow-none !text-white !text-[10px] !font-bold">
                {z.name}
              </Tooltip>
            </Rectangle>
          ))}

          {/* Existing well-vegetated cells */}
          {isGreenspaceActive && greenCells.map(c => (
            <Rectangle
              key={`g-${c.row}-${c.col}`}
              bounds={c.bounds}
              interactive={false}
              pathOptions={{ color: '#45B881', weight: 0.5, fillColor: '#45B881', fillOpacity: (layer('greenspaces')?.opacity ?? 0.6) * 0.4 }}
            />
          ))}

          {/* Heat Hotspot Markers */}
          {isHotspotActive && hotspots.map(hs => (
            <CircleMarker
              key={hs.id}
              center={[hs.coordinates.lat, hs.coordinates.lng]}
              radius={hs.severity === 'high' ? 24 : 18}
              bubblingMouseEvents={false}
              pathOptions={{
                color: hs.severity === 'high' ? '#F05252' : '#F4B942',
                fillColor: hs.severity === 'high' ? '#F05252' : '#F4B942',
                fillOpacity: 0.55,
                weight: 2,
              }}
              eventHandlers={{
                click: () => {
                  setSelectedEntity(hotspotIntel(hs));
                  setSelectedHotspot(hs);
                },
              }}
            >
              <Popup>
                <div className="p-1 font-sans">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900 text-sm">
                    <Flame size={14} className="text-red-500" />
                    {hs.name}
                  </div>
                  <p className="text-xs text-slate-600 mt-1">{hs.location}</p>
                  <div className="mt-2 text-xs flex gap-3 text-slate-800">
                    <span>Temp: <strong>{formatTemp(hs.surfaceTemp)}</strong></span>
                    <span>Veg: <strong>{hs.vegetationCoverage}%</strong></span>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedHotspot(hs);
                      setSelectedEntity(hotspotIntel(hs));
                    }}
                    className="mt-2 w-full py-1 bg-lime-500 hover:bg-lime-600 text-slate-900 font-bold rounded text-xs transition"
                  >
                    View Details
                  </button>
                </div>
              </Popup>
            </CircleMarker>
          ))}

          {/* Greening Opportunities Markers */}
          {isGreenspaceActive && greeningCandidates.map(gc => (
            <CircleMarker
              key={gc.id}
              center={[gc.coordinates.lat, gc.coordinates.lng]}
              radius={16}
              bubblingMouseEvents={false}
              pathOptions={{
                color: '#B7E65C',
                fillColor: '#72C85B',
                fillOpacity: 0.6,
                weight: 2,
                dashArray: '4, 4',
              }}
              eventHandlers={{
                click: () => {
                  setSelectedEntity(candidateIntel(gc));
                  setSelectedCandidate(gc);
                },
              }}
            >
              <Popup>
                <div className="p-1 font-sans">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900 text-sm">
                    <Leaf size={14} className="text-green-600" />
                    {gc.name}
                  </div>
                  <p className="text-xs text-slate-600 mt-1">{gc.location}</p>
                  <p className="text-xs text-slate-800 mt-1">Area: <strong>{gc.candidateArea} ha</strong></p>
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>

        {/* Floating Top Bar: Search & Quick Actions */}
        <div className="absolute top-4 left-4 right-4 z-[1000] flex items-center justify-between pointer-events-none gap-3">
          {/* Search Box */}
          <div className="relative w-full max-w-md pointer-events-auto shadow-2xl">
            <div className="flex items-center gap-2 bg-[var(--bg-panel)]/95 backdrop-blur-md border border-[var(--border)] rounded-2xl px-4 py-2.5 transition-all focus-within:border-[var(--accent)]">
              <Search size={16} className="text-[var(--text-muted)] shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchResults[0] && handleSelectSearchResult(searchResults[0])}
                placeholder={`Search ${area.name} zones, hotspots, any place or coordinates…`}
                className="bg-transparent text-sm w-full outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-0.5"
                >
                  <X size={15} />
                </button>
              )}
            </div>

            {/* Autocomplete Dropdown */}
            <AnimatePresence>
              {searchResults.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="absolute left-0 right-0 top-12 mt-1 rounded-2xl shadow-2xl border border-[var(--border)] overflow-hidden z-50 divide-y divide-[var(--border)]"
                  style={{ background: 'var(--bg-panel)' }}
                >
                  {searchResults.map(item => (
                    <div
                      key={item.id}
                      onClick={() => handleSelectSearchResult(item)}
                      className="px-4 py-3 cursor-pointer hover:bg-[var(--bg-card)] transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{item.name}</p>
                        <p className="text-xs text-[var(--text-muted)] truncate">
                          {item.category} • {item.detail ?? `${item.coords.lat.toFixed(4)}°, ${item.coords.lng.toFixed(4)}°`}
                        </p>
                      </div>
                      {item.veg !== undefined ? (
                        <div className="text-right shrink-0">
                          <span className="text-xs font-mono font-bold text-[var(--alert-high)]">{formatTemp(item.temp)}</span>
                          <span className="text-[10px] text-[var(--text-muted)] block">{item.veg}% veg</span>
                        </div>
                      ) : (
                        <span className="text-[10px] font-semibold text-[var(--accent-green)] shrink-0 flex items-center gap-1">
                          <Satellite size={12} /> Analyse
                        </span>
                      )}
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Right Floating Controls */}
          <div className="flex items-center gap-2 pointer-events-auto">
            {/* Base Tile Selector Pill */}
            <div className="flex bg-[var(--bg-panel)]/95 backdrop-blur-md border border-[var(--border)] rounded-xl p-1 shadow-xl">
              <button
                onClick={() => setTileSource('satellite')}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                  tileSource === 'satellite'
                    ? 'bg-[var(--accent)] text-[var(--accent-foreground)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                )}
              >
                Satellite
              </button>
              <button
                onClick={() => setTileSource('street')}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                  tileSource === 'street'
                    ? 'bg-[var(--accent)] text-[var(--accent-foreground)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                )}
              >
                Street Map
              </button>
            </div>

            <button
              onClick={handleResetView}
              className="btn-ghost bg-[var(--bg-panel)]/95 backdrop-blur-md p-2.5 rounded-xl shadow-xl"
              title="Reset View"
              aria-label="Reset Map View"
            >
              <RotateCcw size={16} />
            </button>

            <button
              onClick={() => setShowLayerPanel(p => !p)}
              className={cn(
                'btn-ghost bg-[var(--bg-panel)]/95 backdrop-blur-md p-2.5 rounded-xl shadow-xl flex items-center gap-2 text-xs font-semibold',
                showLayerPanel && 'border-[var(--accent)] text-[var(--accent)]'
              )}
              title="Toggle Layers Panel"
            >
              <Layers size={16} />
              <span className="hidden sm:inline">Layers</span>
            </button>
          </div>
        </div>

        {/* Floating Layer Panel (Left side) */}
        <AnimatePresence>
          {showLayerPanel && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="absolute top-20 left-4 z-[999] w-72 card p-4 shadow-2xl backdrop-blur-md bg-[var(--bg-panel)]/95 border border-[var(--border)] rounded-2xl space-y-3 max-h-[calc(100%-140px)] overflow-y-auto"
            >
              <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
                  <Layers size={14} className="text-[var(--accent-green)]" />
                  Map Layers
                </span>
                <button
                  onClick={() => setShowLayerPanel(false)}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-0.5"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="space-y-2">
                {mapLayers.map(l => (
                  <div key={l.id} className="rounded-xl hover:bg-[var(--bg-card)] transition-colors">
                    <label className="flex items-center justify-between p-2 cursor-pointer text-xs select-none">
                      <div className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={l.enabled}
                          onChange={() => toggleLayer(l.id)}
                          className="rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]"
                        />
                        <div>
                          <p className="font-semibold text-[var(--text-primary)]">{l.label}</p>
                          <p className="text-[10px] text-[var(--text-muted)]">{l.description}</p>
                        </div>
                      </div>
                      {l.enabled ? (
                        <Eye size={13} className="text-[var(--accent-green)]" />
                      ) : (
                        <EyeOff size={13} className="text-[var(--text-muted)]" />
                      )}
                    </label>
                    {l.enabled && (l.id === 'temperature' || l.id === 'vegetation') && (
                      <input
                        type="range" min={0.1} max={1} step={0.05} value={l.opacity}
                        onChange={e => setLayerOpacity(l.id, Number(e.target.value))}
                        className="w-[calc(100%-1rem)] mx-2 mb-2 accent-[var(--accent)]"
                        aria-label={`${l.label} opacity`}
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Thermal / vegetation legend bar */}
              {legend && (
                <div className="pt-2 border-t border-[var(--border)] space-y-1.5">
                  <div className="flex justify-between text-[10px] font-mono font-medium text-[var(--text-muted)]">
                    <span>{legend.unit === '°C' ? `${formatTemp(legend.min)} (Cooler)` : `${legend.min} ${legend.unit}`}</span>
                    <span>{legend.unit === '°C' ? `${formatTemp(legend.max)} (High Heat)` : `${legend.max} ${legend.unit}`}</span>
                  </div>
                  <div className="h-2.5 rounded-full w-full" style={{ background: legend === overlays.temperature ? HEAT_GRADIENT : VEG_GRADIENT }} />
                  <p className="text-[10px] text-[var(--text-muted)] italic">{legend.label}</p>
                </div>
              )}

              {/* Analysis area size */}
              <div className="pt-2 border-t border-[var(--border)] space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Analysis Area</p>
                <div className="flex items-center gap-1.5">
                  {AREA_WIDTHS.map(w => (
                    <button
                      key={w}
                      onClick={() => setWidthKm(w)}
                      className={cn(
                        'flex-1 py-1 rounded-lg text-[11px] font-semibold border transition-all',
                        widthKm === w ? 'bg-[var(--accent)] text-[var(--accent-foreground)] border-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-secondary)]'
                      )}
                    >
                      {w} km
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => analyse(mapCenter, widthKm === area.widthKm ? area.name : undefined, undefined, widthKm)}
                  className="btn-ghost w-full justify-center text-[11px] py-1.5"
                  title="Analyse the area around the centre of the map"
                >
                  <Crosshair size={13} /> Analyse map centre
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom Coordinates & Scale Bar */}
        <div className="absolute bottom-4 left-4 z-[999] pointer-events-none flex items-center gap-2">
          <div className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-mono bg-[var(--bg-panel)]/90 backdrop-blur-md border border-[var(--border)] text-[var(--text-secondary)] shadow-lg">
            <Navigation size={13} className="text-[var(--accent-green)]" />
            <span>Lat: {currentCoords.lat.toFixed(4)}°</span>
            <span>Lng: {currentCoords.lng.toFixed(4)}°</span>
            <span className="text-[var(--text-muted)]">|</span>
            <span>Zoom: {zoom}x</span>
          </div>
        </div>
      </div>

      {/* Slide-in Selected Location Detail Drawer (Right side) */}
      <AnimatePresence>
        {selectedEntity && (
          <motion.div
            initial={{ opacity: 0, x: 320 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 320 }}
            transition={{ duration: 0.25 }}
            className="w-88 w-full sm:w-96 h-full z-[1000] border-l border-[var(--border)] bg-[var(--bg-panel)] shadow-2xl flex flex-col justify-between overflow-hidden shrink-0"
          >
            {/* Drawer Header */}
            <div>
              <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[var(--accent)]" />
                  <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    Location Intel
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedEntity(null)}
                  className="btn-ghost p-1.5 rounded-lg"
                  aria-label="Close Intel Drawer"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="p-5 space-y-4 overflow-y-auto max-h-[calc(100vh-220px)]">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-xl font-extrabold text-[var(--text-primary)]">
                      {selectedEntity.title}
                    </h2>
                    {selectedEntity.severity && (
                      <span className={cn(
                        'px-2.5 py-0.5 rounded-full text-xs font-bold uppercase shrink-0',
                        selectedEntity.severity === 'high' ? 'badge-high' : selectedEntity.severity === 'medium' ? 'badge-medium' : 'badge-low'
                      )}>
                        {selectedEntity.severity} Severity
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-muted)] flex items-center gap-1 mt-1 font-mono">
                    <MapPin size={12} className="text-[var(--accent)]" />
                    {formatCoords(selectedEntity.coords.lat, selectedEntity.coords.lng)}
                  </p>
                </div>

                {selectedEntity.type !== 'outside' && (
                  <>
                    {/* Key Metrics */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="card p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
                        <div className="flex items-center gap-1.5 text-xs text-[var(--alert-high)] font-semibold mb-1">
                          <Thermometer size={14} /> Surface Temp
                        </div>
                        <p className="text-2xl font-black text-[var(--text-primary)]">{formatTemp(selectedEntity.temp)}</p>
                        <span className="text-[10px] text-[var(--text-muted)]">
                          {provenance.surfaceTemp.kind === 'landsat' ? 'Landsat thermal IR' : provenance.surfaceTemp.isEstimate ? 'Estimated' : 'n/a'}
                        </span>
                      </div>

                      <div className="card p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
                        <div className="flex items-center gap-1.5 text-xs text-[var(--accent-green)] font-semibold mb-1">
                          <Leaf size={14} /> Vegetation Cover
                        </div>
                        <p className="text-2xl font-black text-[var(--text-primary)]">{selectedEntity.veg ?? '–'}%</p>
                        <span className="text-[10px] text-[var(--text-muted)]">
                          {provenance.vegetation.kind === 'sentinel2' ? 'Sentinel-2 NDVI calculated' : 'ESA WorldCover classes'}
                        </span>
                      </div>
                    </div>

                    {selectedEntity.facts && selectedEntity.facts.some(Boolean) && (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedEntity.facts.filter(Boolean).map(f => (
                          <span key={f} className="text-[11px] px-2 py-0.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-secondary)]">{f}</span>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {/* Context & Risk assessment */}
                <div className="space-y-1.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    Diagnostic Summary
                  </h4>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
                    {selectedEntity.details}
                  </p>
                </div>

                {/* Recommended Next Actions */}
                {selectedEntity.actions.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                      Candidate Interventions
                    </h4>
                    <div className="space-y-1.5">
                      {selectedEntity.actions.map((act, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-[var(--text-secondary)] p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
                          <span className="text-[var(--accent-green)] font-bold">✓</span>
                          <span>{act}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Data Provenance & Imagery Date */}
                <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] space-y-1 text-[11px] text-[var(--text-muted)]">
                  <p>Sensor: <strong className="text-[var(--text-secondary)]">{provenance.surfaceTemp.sensor}</strong></p>
                  <p>Vegetation: <strong className="text-[var(--text-secondary)]">{provenance.vegetation.sensor}</strong></p>
                  <p>Acquisition: <strong className="text-[var(--text-secondary)]">
                    {[provenance.surfaceTemp.dates[0], provenance.vegetation.kind === 'sentinel2' ? provenance.vegetation.dates[0] : null]
                      .filter(Boolean).map(d => formatDate(d as string)).join(' · ') || 'n/a'}
                    {` (${(area.cellKm * 1000).toFixed(0)} m grid cells)`}
                  </strong></p>
                  {provenance.surfaceTemp.note && (
                    <p className="italic text-[var(--alert-medium)] pt-1">⚠ {provenance.surfaceTemp.note}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Bottom Action Drawer Button */}
            <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-panel)] space-y-2">
              {selectedEntity.type === 'outside' ? (
                <button
                  onClick={() => analyse(selectedEntity.coords)}
                  className="btn-primary w-full justify-center py-2.5 text-xs font-semibold shadow-md"
                >
                  <Satellite size={15} />
                  Analyse This Location
                </button>
              ) : (
                <button
                  onClick={askAssistantAboutLocation}
                  className="btn-primary w-full justify-center py-2.5 text-xs font-semibold shadow-md"
                >
                  <Sparkles size={15} />
                  Ask Assistant About This Location
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
