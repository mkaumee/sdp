import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapContainer, CircleMarker, Popup, Rectangle, useMap
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Flame, Search, X, SlidersHorizontal, ArrowUpDown, ChevronDown,
  ChevronUp, MapPin, Thermometer, Leaf, Calendar, ArrowRight,
  AlertTriangle, Download, Sparkles, CheckCircle2, ShieldAlert
} from 'lucide-react';
import { useAppStore } from '@/store';
import { AreaGate } from '@/components/ui/AreaGate';
import { SourceBadge } from '@/components/ui/SourceBadge';
import { AreaOutline, BaseTiles, FitBounds, areaBounds } from '@/components/map/MapLayers';
import { cn, average, formatDate, formatTemp, getSeverityLabel } from '@/lib/utils';
import type { AreaData, Hotspot, Severity, LatLng } from '@/types';
import toast from 'react-hot-toast';

const SEV_COLORS: Record<string, string> = {
  high: '#F05252',
  medium: '#F4B942',
  low: '#45B881',
};

function MapFlyTo({ coords }: { coords: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (coords) map.flyTo([coords.lat, coords.lng], 14, { duration: 1 });
  }, [coords, map]);
  return null;
}

export default function HotspotsPage() {
  return <AreaGate>{data => <Hotspots data={data} />}</AreaGate>;
}

function Hotspots({ data }: { data: AreaData }) {
  const { setSelectedHotspot, selectedHotspot, setChatContext, setChatVisible } = useAppStore();
  const { area, hotspots, thresholds, provenance } = data;

  // The temperature slider runs from the hotspot threshold to the hottest reading in this area
  const sliderMin = Math.floor(thresholds.hotspot ?? thresholds.tempMin ?? 25);
  const sliderMax = Math.max(sliderMin + 1, Math.ceil(thresholds.tempMax ?? 45));

  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all');
  const [minTemp, setMinTemp] = useState<number>(sliderMin);
  const [sortKey, setSortKey] = useState<'priorityScore' | 'surfaceTemp' | 'vegetationCoverage'>('priorityScore');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [focusedCoords, setFocusedCoords] = useState<LatLng | null>(null);

  // Filtered & sorted hotspots
  const filtered = useMemo(() => {
    return hotspots
      .filter(h => {
        if (search && !h.name.toLowerCase().includes(search.toLowerCase()) && !h.location.toLowerCase().includes(search.toLowerCase())) {
          return false;
        }
        if (severityFilter !== 'all' && h.severity !== severityFilter) {
          return false;
        }
        if (minTemp > sliderMin && (h.surfaceTemp ?? -Infinity) < minTemp) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const factor = sortDir === 'asc' ? 1 : -1;
        return ((a[sortKey] ?? -Infinity) - (b[sortKey] ?? -Infinity)) * factor;
      });
  }, [hotspots, search, severityFilter, minTemp, sliderMin, sortKey, sortDir]);

  const totalHotspots = hotspots.length;
  const highPriorityCount = hotspots.filter(h => h.severity === 'high').length;
  const avgTemp = formatTemp(average(hotspots.map(h => h.surfaceTemp)));
  const activeFiltersCount = (search ? 1 : 0) + (severityFilter !== 'all' ? 1 : 0) + (minTemp > sliderMin ? 1 : 0);

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const handleSelectHotspot = (hs: Hotspot) => {
    setSelectedHotspot(hs);
    setFocusedCoords(hs.coordinates);
  };

  const handleAskAboutHotspot = (hs: Hotspot) => {
    setChatContext({
      selectedHotspot: hs.name,
      selectedLocation: hs.location,
      selectedCoordinates: hs.coordinates,
      route: '/hotspots',
    });
    setChatVisible(true);
  };

  const handleExportCSV = () => {
    const headers = ['ID', 'Name', 'Location', 'Latitude', 'Longitude', 'Surface Temp (C)', 'Vegetation (%)', 'Severity', 'Priority Score', 'Area (km2)', 'Residents', 'Image Date', 'Source'];
    const rows = filtered.map(h => [
      h.id,
      `"${h.name}"`,
      `"${h.location}"`,
      h.coordinates.lat,
      h.coordinates.lng,
      h.surfaceTemp ?? '',
      h.vegetationCoverage,
      h.severity,
      h.priorityScore,
      h.area ?? '',
      h.people ?? '',
      h.imageDate,
      `"${h.dataSource}"`,
    ]);

    const csv = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `climatesmart_hotspots_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} hotspots to CSV`);
  };

  return (
    <div className="flex flex-col lg:flex-row h-full overflow-hidden">
      {/* Main List & Map Area */}
      <div className="flex-1 flex flex-col overflow-y-auto p-4 lg:p-6 space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-[var(--text-primary)]">Urban Heat Hotspots</h2>
            <p className="text-sm text-[var(--text-secondary)] mt-0.5">
              Identify areas with elevated surface temperatures in {area.name} and prioritize heat resilience interventions.
            </p>
          </div>
          <button
            onClick={handleExportCSV}
            className="btn-ghost self-start sm:self-auto text-xs py-2 px-3 font-semibold flex items-center gap-2"
          >
            <Download size={15} />
            Export Hotspots CSV
          </button>
        </div>

        {/* 4 Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="card p-4 flex flex-col justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
              <Flame size={15} className="text-[var(--alert-high)]" /> Total Detected
            </div>
            <p className="text-2xl font-black text-[var(--text-primary)] my-1">{totalHotspots}</p>
            <span className="text-[10px] text-[var(--text-muted)]">Clusters in the {area.widthKm} km area</span>
          </div>

          <div className="card p-4 flex flex-col justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
              <ShieldAlert size={15} className="text-[var(--alert-high)]" /> High Priority
            </div>
            <p className="text-2xl font-black text-[var(--alert-high)] my-1">{highPriorityCount}</p>
            <span className="text-[10px] text-[var(--text-muted)]">
              Priority 70+ · critical ≥ {formatTemp(thresholds.critical)}
            </span>
          </div>

          <div className="card p-4 flex flex-col justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
              <Thermometer size={15} className="text-[var(--alert-medium)]" /> Avg Hotspot Temp
            </div>
            <p className="text-2xl font-black text-[var(--text-primary)] my-1">{avgTemp}</p>
            <span className="text-[10px] text-[var(--text-muted)]">Across active clusters</span>
          </div>

          <div className="card p-4 flex flex-col justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
              <AlertTriangle size={15} className="text-[var(--info)]" /> Requiring Review
            </div>
            <p className="text-2xl font-black text-[var(--text-primary)] my-1">{filtered.length}</p>
            <span className="text-[10px] text-[var(--text-muted)]">Matching active criteria</span>
          </div>
        </div>

        {/* Interactive Hotspot Map */}
        <div className="card overflow-hidden h-72 relative rounded-2xl border border-[var(--border)] shadow-md">
          <MapContainer
            center={[area.coordinates.lat, area.coordinates.lng]}
            zoom={12}
            style={{ height: '100%', width: '100%', background: '#07111F' }}
            scrollWheelZoom={false}
          >
            <BaseTiles />
            <FitBounds bounds={areaBounds(area)} />
            <MapFlyTo coords={focusedCoords} />
            <AreaOutline area={area} />

            {/* The grid cells that make up each hotspot */}
            {hotspots.flatMap(h => (h.cells ?? []).map(c => (
              <Rectangle
                key={`${h.id}-${c.row}-${c.col}`}
                bounds={c.bounds}
                interactive={false}
                pathOptions={{ color: SEV_COLORS[h.severity], weight: 0.5, fillOpacity: selectedHotspot?.id === h.id ? 0.4 : 0.2 }}
              />
            )))}

            {hotspots.map(h => (
              <CircleMarker
                key={h.id}
                center={[h.coordinates.lat, h.coordinates.lng]}
                radius={h.severity === 'high' ? 22 : 16}
                pathOptions={{
                  color: SEV_COLORS[h.severity],
                  fillColor: SEV_COLORS[h.severity],
                  fillOpacity: selectedHotspot?.id === h.id ? 0.85 : 0.5,
                  weight: selectedHotspot?.id === h.id ? 4 : 2,
                }}
                eventHandlers={{ click: () => handleSelectHotspot(h) }}
              >
                <Popup>
                  <div className="p-1 text-slate-900">
                    <p className="font-bold text-sm">{h.name}</p>
                    <p className="text-xs text-slate-600">{h.location}</p>
                    <p className="text-xs font-semibold text-red-600 mt-1">{formatTemp(h.surfaceTemp)} · {h.vegetationCoverage}% veg</p>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
          <div className="absolute top-3 left-3 z-[1000] px-3 py-1 rounded-xl bg-[var(--bg-panel)]/90 backdrop-blur-md border border-[var(--border)] text-xs text-[var(--text-secondary)]">
            Click hotspot marker to inspect details
          </div>
          {hotspots.length === 0 && (
            <div className="absolute inset-0 z-[1000] flex items-center justify-center pointer-events-none">
              <span className="px-4 py-2 rounded-xl bg-[var(--bg-panel)]/90 border border-[var(--border)] text-xs text-[var(--text-secondary)]">
                No heat hotspots stand out in {area.name} at current thresholds
              </span>
            </div>
          )}
        </div>

        {/* Filter Toolbar */}
        <div className="card p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-[220px] bg-[var(--bg-card)] rounded-xl px-3 py-2 border border-[var(--border)]">
              <Search size={15} className="text-[var(--text-muted)] shrink-0" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search hotspots by name or neighborhood…"
                className="bg-transparent text-sm w-full outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
              {search && (
                <button onClick={() => setSearch('')}>
                  <X size={14} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" />
                </button>
              )}
            </div>

            <button
              onClick={() => setFiltersOpen(p => !p)}
              className={cn(
                'btn-ghost text-xs py-2 px-3 flex items-center gap-2 font-semibold',
                filtersOpen && 'border-[var(--accent)] text-[var(--accent)]'
              )}
            >
              <SlidersHorizontal size={14} />
              Filter Options
              {activeFiltersCount > 0 && (
                <span className="w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center bg-[var(--accent)] text-[var(--accent-foreground)]">
                  {activeFiltersCount}
                </span>
              )}
            </button>

            {activeFiltersCount > 0 && (
              <button
                onClick={() => { setSearch(''); setSeverityFilter('all'); setMinTemp(sliderMin); }}
                className="text-xs text-[var(--alert-high)] font-semibold hover:underline flex items-center gap-1"
              >
                <X size={12} /> Clear all
              </button>
            )}
          </div>

          <AnimatePresence>
            {filtersOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="pt-3 border-t border-[var(--border)] grid grid-cols-1 md:grid-cols-2 gap-4 text-xs"
              >
                <div>
                  <label className="font-semibold text-[var(--text-secondary)] block mb-1.5">Severity</label>
                  <div className="flex gap-2">
                    {(['all', 'high', 'medium', 'low'] as const).map(sev => (
                      <button
                        key={sev}
                        onClick={() => setSeverityFilter(sev)}
                        className={cn(
                          'px-3 py-1.5 rounded-lg font-medium transition-all',
                          severityFilter === sev
                            ? 'bg-[var(--accent)] text-[var(--accent-foreground)] font-bold'
                            : 'bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-secondary)]'
                        )}
                      >
                        {sev === 'all' ? 'All Severities' : getSeverityLabel(sev)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="font-semibold text-[var(--text-secondary)] flex justify-between mb-1.5">
                    <span>Minimum Surface Temperature:</span>
                    <strong className="text-[var(--alert-high)]">{minTemp}°C</strong>
                  </label>
                  <input
                    type="range"
                    min={sliderMin}
                    max={sliderMax}
                    step="0.5"
                    value={minTemp}
                    onChange={e => setMinTemp(parseFloat(e.target.value))}
                    className="w-full accent-[var(--accent)] cursor-pointer"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Data Table */}
        <div className="card overflow-hidden shadow-md">
          <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
            <span className="text-sm font-bold text-[var(--text-primary)]">
              Prioritized Hotspot Registry ({filtered.length})
            </span>
            <SourceBadge source={provenance.surfaceTemp} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--bg-card)] border-b border-[var(--border)] text-[var(--text-muted)] font-semibold">
                <tr>
                  <th className="px-4 py-3">Hotspot Name</th>
                  <th className="px-4 py-3">District</th>
                  <th
                    className="px-4 py-3 cursor-pointer hover:text-[var(--text-primary)] select-none"
                    onClick={() => toggleSort('surfaceTemp')}
                  >
                    <span className="inline-flex items-center gap-1">
                      Surface Temp
                      {sortKey === 'surfaceTemp' && (sortDir === 'desc' ? <ChevronDown size={13} /> : <ChevronUp size={13} />)}
                    </span>
                  </th>
                  <th
                    className="px-4 py-3 cursor-pointer hover:text-[var(--text-primary)] select-none"
                    onClick={() => toggleSort('vegetationCoverage')}
                  >
                    <span className="inline-flex items-center gap-1">
                      Vegetation
                      {sortKey === 'vegetationCoverage' && (sortDir === 'desc' ? <ChevronDown size={13} /> : <ChevronUp size={13} />)}
                    </span>
                  </th>
                  <th
                    className="px-4 py-3 cursor-pointer hover:text-[var(--text-primary)] select-none"
                    onClick={() => toggleSort('priorityScore')}
                  >
                    <span className="inline-flex items-center gap-1">
                      Priority Score
                      {sortKey === 'priorityScore' && (sortDir === 'desc' ? <ChevronDown size={13} /> : <ChevronUp size={13} />)}
                    </span>
                  </th>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filtered.map(hs => (
                  <tr
                    key={hs.id}
                    onClick={() => handleSelectHotspot(hs)}
                    className={cn(
                      'cursor-pointer hover:bg-[var(--bg-card)] transition-colors',
                      selectedHotspot?.id === hs.id && 'bg-[var(--bg-card)] border-l-4 border-l-[var(--accent)]'
                    )}
                  >
                    <td className="px-4 py-3 font-bold text-[var(--text-primary)]">
                      {hs.name}
                      <span className="block text-[10px] font-normal text-[var(--text-muted)] font-mono">
                        {hs.coordinates.lat.toFixed(4)}°, {hs.coordinates.lng.toFixed(4)}°
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{hs.location}</td>
                    <td className="px-4 py-3 font-mono font-bold text-[var(--alert-high)]">{formatTemp(hs.surfaceTemp)}</td>
                    <td className="px-4 py-3 font-mono text-[var(--text-secondary)]">{hs.vegetationCoverage}%</td>
                    <td className="px-4 py-3 font-mono font-bold text-[var(--text-primary)]">{hs.priorityScore} / 100</td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase',
                        hs.severity === 'high' ? 'badge-high' : hs.severity === 'medium' ? 'badge-medium' : 'badge-low'
                      )}>
                        {hs.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSelectHotspot(hs); }}
                        className="btn-ghost py-1 px-2.5 text-xs font-semibold"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Hotspot Detail Drawer (Right side) */}
      <AnimatePresence>
        {selectedHotspot && (
          <motion.div
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 380 }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.25 }}
            className="w-full lg:w-96 shrink-0 border-l border-[var(--border)] bg-[var(--bg-sidebar)] flex flex-col justify-between overflow-hidden shadow-2xl"
          >
            <div>
              <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
                  <Flame size={14} className="text-[var(--alert-high)]" />
                  Hotspot Diagnostic
                </span>
                <button
                  onClick={() => setSelectedHotspot(null)}
                  className="btn-ghost p-1 rounded-lg"
                  aria-label="Close Hotspot Details"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="p-5 space-y-4 overflow-y-auto max-h-[calc(100vh-210px)]">
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black text-[var(--text-primary)]">{selectedHotspot.name}</h3>
                    <span className={cn(
                      'px-2.5 py-0.5 rounded-full text-xs font-bold uppercase',
                      selectedHotspot.severity === 'high' ? 'badge-high' : selectedHotspot.severity === 'medium' ? 'badge-medium' : 'badge-low'
                    )}>
                      {selectedHotspot.severity}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] flex items-center gap-1 mt-1">
                    <MapPin size={12} className="text-[var(--accent)]" /> {selectedHotspot.location}
                  </p>
                </div>

                {/* Metric Grid */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="card p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
                    <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide block">Surface Temp</span>
                    <span className="text-2xl font-black text-[var(--alert-high)]">{formatTemp(selectedHotspot.surfaceTemp)}</span>
                  </div>
                  <div className="card p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
                    <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide block">Vegetation</span>
                    <span className="text-2xl font-black text-[var(--accent-green)]">{selectedHotspot.vegetationCoverage}%</span>
                  </div>
                  <div className="card p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
                    <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide block">Priority Score</span>
                    <span className="text-2xl font-black text-[var(--text-primary)]">{selectedHotspot.priorityScore}/100</span>
                  </div>
                  <div className="card p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
                    <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide block">Footprint</span>
                    <span className="text-2xl font-black text-[var(--text-primary)]">{selectedHotspot.area ?? '–'} km²</span>
                  </div>
                </div>

                <p className="text-[11px] text-[var(--text-muted)] flex flex-wrap gap-x-3 gap-y-1">
                  <span className="flex items-center gap-1"><Calendar size={12} /> Imagery {formatDate(selectedHotspot.imageDate)}</span>
                  {selectedHotspot.people != null && <span>~{selectedHotspot.people.toLocaleString()} residents</span>}
                  <span>{selectedHotspot.dataSource}</span>
                </p>

                {/* Contributing factors */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    Contributing Factors (Hypothesized)
                  </h4>
                  <div className="space-y-1.5">
                    {selectedHotspot.contributing_factors.map((cf, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-xs text-[var(--text-secondary)] p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
                        <AlertTriangle size={13} className="text-[var(--alert-medium)] shrink-0 mt-0.5" />
                        <span>{cf}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)] italic">
                    Note: Contributing factors are derived from ESA WorldCover land cover and the satellite measurements.
                  </p>
                </div>

                {/* Mitigation Suggestions */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    Actionable Mitigations
                  </h4>
                  <div className="space-y-1.5">
                    {selectedHotspot.mitigation_suggestions.map((ms, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-xs text-[var(--text-secondary)] p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
                        <CheckCircle2 size={13} className="text-[var(--accent-green)] shrink-0 mt-0.5" />
                        <span>{ms}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom action */}
            <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-sidebar)]">
              <button
                onClick={() => handleAskAboutHotspot(selectedHotspot)}
                className="btn-primary w-full justify-center py-2.5 text-xs font-semibold shadow-lg"
              >
                <Sparkles size={15} />
                Ask Assistant About {selectedHotspot.name}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
