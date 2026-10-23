import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { MapContainer, Marker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Thermometer, Leaf, Flame, MapPin, ArrowRight,
  TrendingUp, TrendingDown, Map as MapIcon, Info, AlertTriangle,
  Layers, Maximize2
} from 'lucide-react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import { useAppStore } from '@/store';
import { AreaGate } from '@/components/ui/AreaGate';
import { SourceBadge } from '@/components/ui/SourceBadge';
import {
  AreaOutline, BaseTiles, DataOverlay, FitBounds, HEAT_GRADIENT, VEG_GRADIENT, areaBounds, pinIcon,
} from '@/components/map/MapLayers';
import { cn, formatTemp, formatDate, formatCoords, getSeverityLabel } from '@/lib/utils';
import type { AreaData, ClimateZone, Hotspot } from '@/types';

const SEV_COLORS: Record<string, string> = {
  high: '#F05252',
  medium: '#F4B942',
  low: '#45B881',
};

// Custom scatter tooltip
interface ScatterTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: {
      name: string;
      temperature: number;
      vegetation: number;
      severity: string;
    };
  }>;
}

function ScatterTooltip({ active, payload }: ScatterTooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div
      className="card-elevated p-3 text-xs shadow-xl border border-[var(--border)] rounded-xl"
      style={{ background: 'var(--bg-panel)', color: 'var(--text-primary)' }}
    >
      <p className="font-bold text-sm mb-1">{d?.name}</p>
      <div className="space-y-0.5 text-[var(--text-secondary)]">
        <p>Surface Temp: <strong className="text-[var(--text-primary)]">{d?.temperature}°C</strong></p>
        <p>Vegetation Cover: <strong className="text-[var(--text-primary)]">{d?.vegetation}%</strong></p>
        <p className="flex items-center gap-1.5 mt-1">
          Severity:
          <span className={cn(
            'px-1.5 py-0.5 rounded text-[10px] font-bold uppercase',
            d?.severity === 'high' ? 'badge-high' : d?.severity === 'medium' ? 'badge-medium' : 'badge-low'
          )}>
            {d?.severity}
          </span>
        </p>
      </div>
    </div>
  );
}

// Priority badge component
function PriorityBadge({ severity }: { severity: string }) {
  const cls = severity === 'high' ? 'badge-high' : severity === 'medium' ? 'badge-medium' : 'badge-low';
  return <span className={cn(cls, 'px-2.5 py-0.5 rounded-full font-semibold text-xs')}>{getSeverityLabel(severity as any)}</span>;
}

export default function OverviewPage() {
  return <AreaGate>{data => <Overview data={data} />}</AreaGate>;
}

function Overview({ data }: { data: AreaData }) {
  const navigate = useNavigate();
  const { setSelectedZone, setSelectedHotspot, setSelectedCandidate, setMapView, setChatContext, setChatVisible } = useAppStore();
  const [mapMode, setMapMode] = useState<'heat' | 'vegetation'>('heat');
  const { area, provenance, zones, hotspots, greeningCandidates, metrics } = data;
  const coords = formatCoords(area.coordinates.lat, area.coordinates.lng);
  const overlay = mapMode === 'heat' ? data.overlays.temperature : data.overlays.vegetation;
  const topCandidate = greeningCandidates[0];

  // Scatter points: one per compass zone that has a temperature reading.
  const scatterData = zones
    .filter(z => z.surfaceTemp !== null)
    .map(z => ({ name: z.name, temperature: z.surfaceTemp as number, vegetation: z.vegetationCoverage, severity: z.severity }));
  const temps = scatterData.map(d => d.temperature);
  const tempDomain = temps.length ? [Math.floor(Math.min(...temps)) - 1, Math.ceil(Math.max(...temps)) + 1] : [25, 40];

  const metricIcons = [
    { icon: <Thermometer size={20} />, color: 'var(--alert-high)', bg: 'rgba(240, 82, 82, 0.1)' },
    { icon: <Leaf size={20} />, color: 'var(--accent-green)', bg: 'rgba(114, 200, 91, 0.1)' },
    { icon: <Flame size={20} />, color: 'var(--alert-medium)', bg: 'rgba(244, 185, 66, 0.1)' },
    { icon: <MapPin size={20} />, color: 'var(--info)', bg: 'rgba(92, 167, 255, 0.1)' },
  ];

  const urgent = hotspots.filter(h => h.severity === 'high');
  const topHotspots = (urgent.length ? urgent : hotspots).slice(0, 3);

  const handleZoneClick = (zone: ClimateZone) => {
    setSelectedZone(zone);
    setMapView(zone.coordinates, 14);
    navigate('/map-explorer');
  };

  const handleOpenHotspot = (hs: Hotspot) => {
    setSelectedHotspot(hs);
    navigate('/hotspots');
  };

  const handleAskAssistant = (topic: string) => {
    setChatContext({
      selectedLocation: area.name,
      selectedCoordinates: area.coordinates,
      selectedHotspot: topic,
      route: '/overview',
    });
    setChatVisible(true);
  };

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1440px] mx-auto">
      {/* Hero Section */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="card p-6 relative overflow-hidden"
        style={{
          background: 'radial-gradient(ellipse at 85% 0%, rgba(183, 230, 92, 0.08) 0%, var(--bg-panel) 70%)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />
              Active Analysis Area: <strong className="text-[var(--text-primary)]">{area.location}</strong>
            </div>
            <h2 className="text-2xl lg:text-3xl font-extrabold tracking-tight text-[var(--text-primary)]">
              See the heat. <span style={{ color: 'var(--accent-green)' }}>Find room for green.</span>
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Explore urban surface temperatures, vegetation coverage, and prioritized locations to deploy climate-resilient urban forestry and shade infrastructure.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-[var(--text-muted)]">
              <span className="flex items-center gap-1">
                <MapPin size={13} style={{ color: 'var(--accent)' }} /> {coords}
              </span>
              <span>•</span>
              <span>Updated: {formatDate(provenance.updated)} ({provenance.sensorsLabel})</span>
              <span>•</span>
              <SourceBadge source={provenance.surfaceTemp} />
              <SourceBadge source={provenance.vegetation} />
            </div>
            {data.warnings.length > 0 && (
              <p className="flex items-center gap-1.5 text-[11px] text-[var(--alert-medium)]">
                <AlertTriangle size={12} /> {data.warnings.join(' · ')}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => handleAskAssistant('General overview')}
              className="btn-ghost text-xs py-2.5 px-4"
            >
              Ask AI About Area
            </button>
            <button
              onClick={() => navigate('/map-explorer')}
              className="btn-primary py-2.5 px-4 text-xs font-semibold"
            >
              <MapIcon size={16} />
              Open Map Explorer
            </button>
          </div>
        </div>
      </motion.div>

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((metric, i) => (
          <motion.div
            key={metric.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: i * 0.06 }}
            className="card p-5 flex flex-col justify-between relative overflow-hidden group hover:border-[var(--accent)] transition-all"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: metricIcons[i].bg, color: metricIcons[i].color }}
                >
                  {metricIcons[i].icon}
                </div>
                <span className="text-xs font-semibold text-[var(--text-secondary)] leading-snug">
                  {metric.label}
                </span>
              </div>
              <div className="group/tooltip relative">
                <Info size={14} className="text-[var(--text-muted)] cursor-help" />
                <div
                  className="absolute right-0 top-6 z-30 hidden group-hover/tooltip:block w-60 p-2.5 text-xs rounded-xl shadow-2xl border"
                  style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  <p className="font-semibold text-[var(--text-primary)] mb-1">{metric.label}</p>
                  <p>{metric.description}</p>
                  <p className="mt-1 text-[10px] text-[var(--text-muted)] italic">Source: {metric.dataSource}</p>
                </div>
              </div>
            </div>

            <div className="my-3">
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-extrabold tracking-tight text-[var(--text-primary)]">
                  {metric.value}
                </span>
                <span className="text-lg font-semibold text-[var(--text-secondary)]">
                  {metric.unit}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs pt-2 border-t border-[var(--border)]">
              {metric.trend ? (
                <div className={cn(
                  'flex items-center gap-1 font-semibold',
                  metric.trend === 'up' ? 'text-[var(--alert-high)]' : 'text-[var(--alert-low)]'
                )}>
                  {metric.trend === 'up' ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                  <span>
                    {metric.trend === 'up' ? '+' : '-'}{metric.trendValue}
                    {metric.unit === '%' ? 'pp' : metric.unit === '°C' ? '°C' : ''}
                  </span>
                  {metric.trendPeriod && (
                    <span className="font-normal text-[var(--text-muted)] ml-1">
                      {metric.trendPeriod}
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-[var(--text-muted)]">At current thresholds</span>
              )}
              <span className="text-[10px] text-[var(--text-muted)] italic truncate max-w-[55%] text-right" title={metric.dataSource}>
                {metric.dataSource}
              </span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Main Analytics Area: Township Map Preview + Priority Signals */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Township Climate Map (8 cols) */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
          className="lg:col-span-7 card p-5 flex flex-col gap-4 relative overflow-hidden"
        >
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-[var(--text-primary)]">Township Climate Map</h3>
                <span className="text-[11px] px-2 py-0.5 rounded font-medium bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)]">
                  {area.name}
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Heat and vegetation coverage by urban zone</p>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex p-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
                <button
                  onClick={() => setMapMode('heat')}
                  className={cn(
                    'px-3 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5',
                    mapMode === 'heat'
                      ? 'bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  )}
                >
                  <Flame size={13} />
                  Heat
                </button>
                <button
                  onClick={() => setMapMode('vegetation')}
                  className={cn(
                    'px-3 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5',
                    mapMode === 'vegetation'
                      ? 'bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  )}
                >
                  <Leaf size={13} />
                  Vegetation
                </button>
              </div>

              <button
                onClick={() => navigate('/map-explorer')}
                className="btn-ghost p-1.5 rounded-lg"
                title="Expand to Full Map Explorer"
                aria-label="Expand to Map Explorer"
              >
                <Maximize2 size={16} />
              </button>
            </div>
          </div>

          {/* Map canvas: satellite base map with the measured heat or vegetation layer on top */}
          <div className="relative rounded-2xl overflow-hidden border border-[var(--border)] bg-[#07111F] h-[340px] shadow-inner">
            <MapContainer
              center={[area.coordinates.lat, area.coordinates.lng]}
              zoom={12}
              zoomControl={false}
              scrollWheelZoom={false}
              attributionControl={false}
              style={{ height: '100%', width: '100%', background: '#07111F' }}
            >
              <FitBounds bounds={areaBounds(area)} />
              <BaseTiles />
              <DataOverlay overlay={overlay} opacity={0.7} />
              <AreaOutline area={area} />
              {topHotspots[0] && (
                <Marker
                  position={[topHotspots[0].coordinates.lat, topHotspots[0].coordinates.lng]}
                  icon={pinIcon('heat', 'High Temperature Zone', `${formatTemp(topHotspots[0].surfaceTemp)} · ${topHotspots[0].name}`, true)}
                  eventHandlers={{ click: () => handleOpenHotspot(topHotspots[0]) }}
                />
              )}
              {topCandidate && (
                <Marker
                  position={[topCandidate.coordinates.lat, topCandidate.coordinates.lng]}
                  icon={pinIcon('green', 'Low Vegetation', `${topCandidate.currentVegetation}% · Greening Candidate`)}
                  eventHandlers={{ click: () => { setSelectedCandidate(topCandidate); navigate('/greening'); } }}
                />
              )}
            </MapContainer>

            {/* Bottom Left Coordinate Pill */}
            <div className="absolute bottom-3 left-3 z-[400] pointer-events-none">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-[11px] font-medium bg-[#091522]/90 text-slate-200 border border-slate-700 backdrop-blur-md">
                <MapPin size={13} className="text-[#B7E65C]" />
                <span>{coords}</span>
                <span className="text-slate-500">•</span>
                <span className="text-slate-400">{area.widthKm} km area</span>
              </div>
            </div>

            {/* Bottom Right Heat / Veg Scale */}
            {overlay && (
              <div className="absolute bottom-3 right-3 z-[400] pointer-events-none">
                <div className="flex items-center gap-3 px-3 py-1.5 rounded-xl text-[11px] bg-[#091522]/90 text-slate-200 border border-slate-700 backdrop-blur-md">
                  <span className="text-[10px] font-mono font-bold text-slate-300">{overlay.min}{overlay.unit === '°C' ? '°C' : ''}</span>
                  <div className="w-20 h-2.5 rounded-full" style={{ background: mapMode === 'heat' ? HEAT_GRADIENT : VEG_GRADIENT }} />
                  <span className="text-[10px] font-mono font-bold text-slate-300">
                    {overlay.max}{overlay.unit === '°C' ? '°C' : overlay.unit === '%' ? '%' : ''} {overlay.unit === 'NDVI' ? 'NDVI' : ''}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-xs pt-1 text-[var(--text-muted)]">
            <span className="flex items-center gap-1.5">
              <Layers size={13} /> Showing {mapMode === 'heat' ? 'Land Surface Temperature (LST)' : 'Normalized Difference Vegetation (NDVI)'}
              {overlay && <span className="hidden sm:inline">· {overlay.label}</span>}
            </span>
            <button
              onClick={() => navigate('/map-explorer')}
              className="font-semibold hover:underline flex items-center gap-1 text-[var(--accent-green)]"
            >
              Interactive Map Explorer <ArrowRight size={13} />
            </button>
          </div>
        </motion.div>

        {/* Priority Signals Panel (5 cols) */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="lg:col-span-5 card p-5 flex flex-col justify-between gap-4"
        >
          <div>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-[var(--text-primary)]">Priority Signals</h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Rule-based screening, not a final decision</p>
              </div>
              <span className="badge-high text-xs px-2 py-0.5 rounded-full font-bold">
                {urgent.length} Urgent
              </span>
            </div>

            <div className="mt-4 space-y-2.5">
              {topHotspots.length === 0 && (
                <p className="text-xs text-[var(--text-muted)] p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
                  No heat hotspots stand out in {area.name} at current thresholds.
                </p>
              )}
              {topHotspots.map(hs => (
                <div
                  key={hs.id}
                  onClick={() => handleOpenHotspot(hs)}
                  className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--accent)] hover:shadow-md cursor-pointer transition-all flex items-center justify-between group"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
                        {hs.name}
                      </p>
                      <PriorityBadge severity={hs.severity} />
                    </div>
                    <p className="text-xs text-[var(--text-secondary)]">
                      <span className="font-semibold text-[var(--alert-high)]">{formatTemp(hs.surfaceTemp)}</span>
                      <span className="text-[var(--text-muted)]"> · </span>
                      <span>{hs.vegetationCoverage}% vegetation</span>
                    </p>
                  </div>

                  <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[var(--bg-panel)] group-hover:bg-[var(--accent)] group-hover:text-[var(--accent-foreground)] transition-colors">
                    <ArrowRight size={15} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t border-[var(--border)] space-y-3">
            <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] text-xs text-[var(--text-secondary)] leading-relaxed">
              <span className="font-semibold text-[var(--text-primary)]">Selection logic:</span> Zones combining high land surface temperature with minimal vegetation canopy receive top priority scoring for heat mitigation intervention.
            </div>

            <button
              onClick={() => navigate('/reports')}
              className="btn-primary w-full justify-center py-2.5 text-xs font-semibold"
            >
              Open full report <ArrowRight size={15} />
            </button>
          </div>
        </motion.div>
      </div>

      {/* Supporting Analytics: Scatter Plot + Zone Snapshot Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Scatter Chart (6 cols) */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.25 }}
          className="lg:col-span-6 card p-5 flex flex-col justify-between"
        >
          <div>
            <div className="flex items-start justify-between mb-2">
              <div>
                <h3 className="text-base font-bold text-[var(--text-primary)]">Temperature vs. Vegetation</h3>
                <p className="text-xs text-[var(--text-muted)]">Hot and bare zones sit top-left</p>
              </div>
              <span className="text-[10px] text-[var(--text-muted)] italic">{zones.length} zones · {provenance.surfaceTemp.label}</span>
            </div>

            <div className="h-64 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 15, bottom: 20, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} />
                  <XAxis
                    dataKey="vegetation"
                    name="Vegetation %"
                    type="number"
                    domain={[0, 100]}
                    tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                    unit="%"
                    label={{ value: 'Vegetation %', position: 'insideBottom', offset: -12, style: { fontSize: 11, fill: 'var(--text-muted)' } }}
                  />
                  <YAxis
                    dataKey="temperature"
                    name="Temperature"
                    domain={tempDomain}
                    tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                    unit="°C"
                    label={{ value: 'Surface Temp (°C)', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: 'var(--text-muted)' } }}
                  />
                  <Tooltip content={<ScatterTooltip />} />
                  <Scatter data={scatterData}>
                    {scatterData.map((entry, index) => (
                      <Cell
                        key={index}
                        fill={SEV_COLORS[entry.severity] || '#F05252'}
                        fillOpacity={0.88}
                        r={10}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs pt-3 border-t border-[var(--border)] text-[var(--text-muted)]">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#F05252]" /> High risk</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#F4B942]" /> Moderate</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#45B881]" /> Low risk</span>
            </div>
            <span title="Pearson correlation across every grid cell">
              {data.correlation === null ? 'Correlation n/a'
                : `${data.correlation < 0 ? 'Negative' : 'Positive'} correlation r = ${data.correlation.toFixed(2)}`}
            </span>
          </div>
        </motion.div>

        {/* Zone Snapshot Table (6 cols) */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.3 }}
          className="lg:col-span-6 card overflow-hidden flex flex-col justify-between"
        >
          <div>
            <div className="p-5 pb-3 flex items-center justify-between border-b border-[var(--border)]">
              <div>
                <h3 className="text-base font-bold text-[var(--text-primary)]">Zone Snapshot</h3>
                <p className="text-xs text-[var(--text-muted)]">Compare monitored candidate locations</p>
              </div>
              <span className="text-[10px] text-[var(--text-muted)] italic">Click a row to navigate</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[var(--bg-card)] border-b border-[var(--border)] text-[var(--text-muted)] font-semibold">
                    <th className="px-4 py-2.5">Zone</th>
                    <th className="px-4 py-2.5">Surface °C</th>
                    <th className="px-4 py-2.5">Veg. %</th>
                    <th className="px-4 py-2.5">Priority</th>
                    <th className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {zones.map(zone => (
                    <tr
                      key={zone.id}
                      onClick={() => handleZoneClick(zone)}
                      className="cursor-pointer hover:bg-[var(--bg-card)] transition-colors group"
                    >
                      <td className="px-4 py-3 font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)]">
                        {zone.name}
                        <span className="block text-[10px] font-normal text-[var(--text-muted)]">{zone.location}</span>
                      </td>
                      <td className="px-4 py-3 font-mono font-medium text-[var(--text-primary)]">
                        {formatTemp(zone.surfaceTemp)}
                      </td>
                      <td className="px-4 py-3 font-mono text-[var(--text-secondary)]">
                        {zone.vegetationCoverage}%
                      </td>
                      <td className="px-4 py-3">
                        <PriorityBadge severity={zone.severity} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-xs font-semibold text-[var(--accent-green)] group-hover:underline inline-flex items-center gap-0.5">
                          View <ArrowRight size={11} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="p-4 border-t border-[var(--border)] flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>Showing all {zones.length} compass zones of {area.name}</span>
            <button
              onClick={() => navigate('/hotspots')}
              className="font-semibold text-[var(--accent-green)] hover:underline flex items-center gap-1"
            >
              See all hotspots <ArrowRight size={13} />
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
