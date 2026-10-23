import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapContainer, TileLayer, CircleMarker, Popup, useMap, ZoomControl
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Search, X, Layers, Maximize2, RotateCcw, MapPin,
  Thermometer, Leaf, Flame, ArrowRight, Info, Eye, EyeOff,
  Navigation, ShieldAlert, Sparkles, Filter
} from 'lucide-react';
import { useAppStore } from '@/store';
import { demoHotspots, demoGreeningCandidates, demoZones, DEMO_CENTER, DEMO_LABEL } from '@/data/demo';
import { cn, formatTemp, formatDate, getSeverityLabel } from '@/lib/utils';
import type { Hotspot, GreeningCandidate, ClimateZone, LatLng } from '@/types';

// Map view controller component to handle programmatic pan/zoom
function MapController({ center, zoom }: { center: LatLng; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([center.lat, center.lng], zoom, { duration: 1.2 });
  }, [center, zoom, map]);
  return null;
}

// Predefined searchable locations
const SEARCHABLE_ITEMS = [
  ...demoZones.map(z => ({ id: z.id, name: z.name, category: 'Zone', coords: z.coordinates, temp: z.surfaceTemp, veg: z.vegetationCoverage })),
  ...demoHotspots.map(h => ({ id: h.id, name: h.name, category: 'Hotspot', coords: h.coordinates, temp: h.surfaceTemp, veg: h.vegetationCoverage })),
  ...demoGreeningCandidates.map(g => ({ id: g.id, name: g.name, category: 'Greening Candidate', coords: g.coordinates, temp: g.surfaceTemp, veg: g.currentVegetation })),
  { id: 'lagos-island', name: 'Lagos Island', category: 'District', coords: { lat: 6.4549, lng: 3.4246 }, temp: 36.5, veg: 12 },
  { id: 'victoria-island', name: 'Victoria Island', category: 'District', coords: { lat: 6.4281, lng: 3.4219 }, temp: 35.8, veg: 15 },
  { id: 'ikeja', name: 'Ikeja Capital', category: 'District', coords: { lat: 6.6018, lng: 3.3515 }, temp: 36.8, veg: 10 },
  { id: 'lekki', name: 'Lekki Peninsula', category: 'District', coords: { lat: 6.4698, lng: 3.5852 }, temp: 32.4, veg: 28 },
  { id: 'surulere', name: 'Surulere', category: 'District', coords: { lat: 6.4988, lng: 3.3555 }, temp: 33.5, veg: 24 },
  { id: 'yaba', name: 'Yaba Tech Hub', category: 'District', coords: { lat: 6.5088, lng: 3.3744 }, temp: 31.9, veg: 42 },
];

export default function MapExplorerPage() {
  const {
    mapCenter, mapZoom, setMapView,
    mapLayers, toggleLayer,
    selectedHotspot, setSelectedHotspot,
    selectedCandidate, setSelectedCandidate,
    setChatContext, setChatVisible
  } = useAppStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<typeof SEARCHABLE_ITEMS>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<{
    title: string;
    type: 'hotspot' | 'greening' | 'zone';
    coords: LatLng;
    temp: number;
    veg: number;
    severity: 'high' | 'medium' | 'low';
    details: string;
    actions: string[];
  } | null>(null);

  const [tileSource, setTileSource] = useState<'satellite' | 'street'>('satellite');
  const [showLayerPanel, setShowLayerPanel] = useState(true);
  const [currentCoords, setCurrentCoords] = useState<LatLng>(DEMO_CENTER);

  // Search filter
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const q = searchQuery.toLowerCase();
    const results = SEARCHABLE_ITEMS.filter(item =>
      item.name.toLowerCase().includes(q) || item.category.toLowerCase().includes(q)
    ).slice(0, 5);
    setSearchResults(results);
  }, [searchQuery]);

  const handleSelectSearchResult = (item: typeof SEARCHABLE_ITEMS[0]) => {
    setMapView(item.coords, 14);
    setCurrentCoords(item.coords);
    setSearchQuery('');
    setSearchResults([]);

    setSelectedEntity({
      title: item.name,
      type: item.category === 'Hotspot' ? 'hotspot' : item.category === 'Greening Candidate' ? 'greening' : 'zone',
      coords: item.coords,
      temp: item.temp,
      veg: item.veg,
      severity: item.temp > 35 ? 'high' : item.temp > 32 ? 'medium' : 'low',
      details: `Monitored region in Lagos metropolitan area with surface temperature reading of ${item.temp}°C and vegetation cover of ${item.veg}%.`,
      actions: ['Inspect satellite canopy', 'Evaluate cool roof potential', 'Review tree canopy gap'],
    });
  };

  const handleResetView = () => {
    setMapView(DEMO_CENTER, 12);
    setCurrentCoords(DEMO_CENTER);
    setSelectedEntity(null);
  };

  const askAssistantAboutLocation = () => {
    if (!selectedEntity) return;
    setChatContext({
      selectedLocation: selectedEntity.title,
      selectedCoordinates: selectedEntity.coords,
      route: '/map-explorer',
    });
    setChatVisible(true);
  };

  // Check layer states
  const isHeatActive = mapLayers.find(l => l.id === 'temperature')?.enabled ?? true;
  const isVegActive = mapLayers.find(l => l.id === 'vegetation')?.enabled ?? false;
  const isHotspotActive = mapLayers.find(l => l.id === 'hotspots')?.enabled ?? true;
  const isGreenspaceActive = mapLayers.find(l => l.id === 'greenspaces')?.enabled ?? true;

  return (
    <div className="relative w-full h-[calc(100vh-61px)] overflow-hidden flex">
      {/* Map Area */}
      <div className="flex-1 relative h-full w-full">
        <MapContainer
          center={[DEMO_CENTER.lat, DEMO_CENTER.lng]}
          zoom={12}
          zoomControl={false}
          style={{ height: '100%', width: '100%', background: '#07111F' }}
        >
          <ZoomControl position="bottomright" />
          <MapController center={mapCenter} zoom={mapZoom} />

          {/* Base Tiles: Satellite vs Street */}
          {tileSource === 'satellite' ? (
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
          )}

          {/* Heat Hotspot Markers */}
          {isHotspotActive && demoHotspots.map(hs => (
            <CircleMarker
              key={hs.id}
              center={[hs.coordinates.lat, hs.coordinates.lng]}
              radius={hs.severity === 'high' ? 24 : 18}
              pathOptions={{
                color: hs.severity === 'high' ? '#F05252' : '#F4B942',
                fillColor: hs.severity === 'high' ? '#F05252' : '#F4B942',
                fillOpacity: 0.55,
                weight: 2,
              }}
              eventHandlers={{
                click: () => {
                  setSelectedEntity({
                    title: hs.name,
                    type: 'hotspot',
                    coords: hs.coordinates,
                    temp: hs.surfaceTemp,
                    veg: hs.vegetationCoverage,
                    severity: hs.severity,
                    details: hs.contributing_factors.join('; '),
                    actions: hs.mitigation_suggestions,
                  });
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
                    <span>Temp: <strong>{hs.surfaceTemp}°C</strong></span>
                    <span>Veg: <strong>{hs.vegetationCoverage}%</strong></span>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedHotspot(hs);
                      setSelectedEntity({
                        title: hs.name,
                        type: 'hotspot',
                        coords: hs.coordinates,
                        temp: hs.surfaceTemp,
                        veg: hs.vegetationCoverage,
                        severity: hs.severity,
                        details: hs.contributing_factors.join('; '),
                        actions: hs.mitigation_suggestions,
                      });
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
          {isGreenspaceActive && demoGreeningCandidates.map(gc => (
            <CircleMarker
              key={gc.id}
              center={[gc.coordinates.lat, gc.coordinates.lng]}
              radius={16}
              pathOptions={{
                color: '#B7E65C',
                fillColor: '#72C85B',
                fillOpacity: 0.6,
                weight: 2,
                dashArray: '4, 4',
              }}
              eventHandlers={{
                click: () => {
                  setSelectedEntity({
                    title: gc.name,
                    type: 'greening',
                    coords: gc.coordinates,
                    temp: gc.surfaceTemp,
                    veg: gc.currentVegetation,
                    severity: gc.severity,
                    details: gc.reasoning,
                    actions: [gc.recommendedAction],
                  });
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

          {/* Simulated Temperature Thermal Gradient Layer */}
          {isHeatActive && (
            <CircleMarker
              center={[6.4541, 3.4005]}
              radius={80}
              pathOptions={{
                color: '#F05252',
                fillColor: '#F05252',
                fillOpacity: 0.22,
                weight: 0,
              }}
            />
          )}

          {/* Simulated Vegetation NDVI Green Layer */}
          {isVegActive && (
            <CircleMarker
              center={[6.5088, 3.3744]}
              radius={90}
              pathOptions={{
                color: '#45B881',
                fillColor: '#45B881',
                fillOpacity: 0.25,
                weight: 0,
              }}
            />
          )}
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
                placeholder="Search Lagos zones, hotspots, coordinates…"
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
                      className="px-4 py-3 cursor-pointer hover:bg-[var(--bg-card)] transition-colors flex items-center justify-between"
                    >
                      <div>
                        <p className="text-sm font-semibold text-[var(--text-primary)]">{item.name}</p>
                        <p className="text-xs text-[var(--text-muted)]">{item.category} • {item.coords.lat.toFixed(4)}°, {item.coords.lng.toFixed(4)}°</p>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-mono font-bold text-[var(--alert-high)]">{item.temp}°C</span>
                        <span className="text-[10px] text-[var(--text-muted)] block">{item.veg}% veg</span>
                      </div>
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
              className="absolute top-20 left-4 z-[999] w-72 card p-4 shadow-2xl backdrop-blur-md bg-[var(--bg-panel)]/95 border border-[var(--border)] rounded-2xl space-y-3"
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
                {mapLayers.map(layer => (
                  <label
                    key={layer.id}
                    className="flex items-center justify-between p-2 rounded-xl hover:bg-[var(--bg-card)] cursor-pointer transition-colors text-xs select-none"
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={layer.enabled}
                        onChange={() => toggleLayer(layer.id)}
                        className="rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]"
                      />
                      <div>
                        <p className="font-semibold text-[var(--text-primary)]">{layer.label}</p>
                        <p className="text-[10px] text-[var(--text-muted)]">{layer.description}</p>
                      </div>
                    </div>
                    {layer.enabled ? (
                      <Eye size={13} className="text-[var(--accent-green)]" />
                    ) : (
                      <EyeOff size={13} className="text-[var(--text-muted)]" />
                    )}
                  </label>
                ))}
              </div>

              {/* Thermal Legend Bar */}
              <div className="pt-2 border-t border-[var(--border)] space-y-1.5">
                <div className="flex justify-between text-[10px] font-mono font-medium text-[var(--text-muted)]">
                  <span>28°C (Cooler)</span>
                  <span>40°C (High Heat)</span>
                </div>
                <div className="h-2.5 rounded-full w-full bg-gradient-to-r from-[#45B881] via-[#F4B942] to-[#F05252]" />
                <p className="text-[10px] text-[var(--text-muted)] italic">
                  ⚠ Illustrative layer overlay based on demonstration dataset.
                </p>
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
            <span>Zoom: {mapZoom}x</span>
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
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-extrabold text-[var(--text-primary)]">
                      {selectedEntity.title}
                    </h2>
                    <span className={cn(
                      'px-2.5 py-0.5 rounded-full text-xs font-bold uppercase',
                      selectedEntity.severity === 'high' ? 'badge-high' : selectedEntity.severity === 'medium' ? 'badge-medium' : 'badge-low'
                    )}>
                      {selectedEntity.severity} Severity
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] flex items-center gap-1 mt-1 font-mono">
                    <MapPin size={12} className="text-[var(--accent)]" />
                    {selectedEntity.coords.lat.toFixed(4)}° N, {selectedEntity.coords.lng.toFixed(4)}° E
                  </p>
                </div>

                {/* Key Metrics */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="card p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
                    <div className="flex items-center gap-1.5 text-xs text-[var(--alert-high)] font-semibold mb-1">
                      <Thermometer size={14} /> Surface Temp
                    </div>
                    <p className="text-2xl font-black text-[var(--text-primary)]">{selectedEntity.temp}°C</p>
                    <span className="text-[10px] text-[var(--text-muted)]">Thermal IR sensor</span>
                  </div>

                  <div className="card p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
                    <div className="flex items-center gap-1.5 text-xs text-[var(--accent-green)] font-semibold mb-1">
                      <Leaf size={14} /> Vegetation Cover
                    </div>
                    <p className="text-2xl font-black text-[var(--text-primary)]">{selectedEntity.veg}%</p>
                    <span className="text-[10px] text-[var(--text-muted)]">NDVI calculated</span>
                  </div>
                </div>

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

                {/* Data Provenance & Imagery Date */}
                <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] space-y-1 text-[11px] text-[var(--text-muted)]">
                  <p>Sensor: <strong className="text-[var(--text-secondary)]">Sentinel-2A & Landsat-9 TIRS</strong></p>
                  <p>Acquisition: <strong className="text-[var(--text-secondary)]">Sep 15, 2024 (10m res)</strong></p>
                  <p className="italic text-[var(--alert-medium)] pt-1">⚠ {DEMO_LABEL}</p>
                </div>
              </div>
            </div>

            {/* Bottom Action Drawer Button */}
            <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-panel)] space-y-2">
              <button
                onClick={askAssistantAboutLocation}
                className="btn-primary w-full justify-center py-2.5 text-xs font-semibold shadow-md"
              >
                <Sparkles size={15} />
                Ask Assistant About This Location
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
