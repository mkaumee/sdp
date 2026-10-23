import { motion } from 'framer-motion';
import {
  Settings, Sun, Moon, Monitor, Map, MessageSquare,
  Database, User, Shield, Trash2, CheckCircle2, RotateCcw,
  Sparkles, ExternalLink
} from 'lucide-react';
import { useAppStore, DEFAULT_AREA } from '@/store';
import { SourceBadge } from '@/components/ui/SourceBadge';
import { formatCoords, formatDate } from '@/lib/utils';
import type { AssistantStyle, Theme } from '@/types';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const {
    theme, setTheme,
    units, setUnits,
    chatVisible, setChatVisible,
    clearChat,
    responseStyle, setResponseStyle,
    baseMap: defaultLayer, setBaseMap: setDefaultLayer,
    animationsEnabled, setAnimationsEnabled,
    area, areaData, setArea,
  } = useAppStore();
  const prov = areaData?.provenance;

  const handleClearChatHistory = () => {
    clearChat();
    toast.success('Assistant conversation history cleared');
  };

  const handleResetPreferences = () => {
    setTheme('dark');
    setUnits('metric');
    setChatVisible(true);
    setResponseStyle('scientific');
    setDefaultLayer('satellite');
    setAnimationsEnabled(true);
    toast.success('Preferences reset to default values');
  };

  return (
    <div className="p-4 lg:p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-black text-[var(--text-primary)]">System Settings</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-0.5">
          Configure appearance, geospatial parameters, AI assistant behavior, and data provenance.
        </p>
      </div>

      {/* 1. Appearance */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-[var(--border)]">
          <Sun size={18} className="text-[var(--accent)]" />
          <h3 className="font-bold text-base text-[var(--text-primary)]">Appearance & Theme</h3>
        </div>

        <div className="space-y-3">
          <label className="text-xs font-semibold text-[var(--text-secondary)] block">Theme Selection</label>
          <div className="grid grid-cols-3 gap-3">
            {[
              { id: 'light' as Theme, label: 'Light Mode', icon: Sun, desc: 'Clean white & soft green' },
              { id: 'dark' as Theme, label: 'Dark Mode', icon: Moon, desc: 'Deep navy & lime accent' },
              { id: 'system' as Theme, label: 'System Match', icon: Monitor, desc: 'Syncs with OS theme' },
            ].map(item => {
              const Icon = item.icon;
              const isSelected = theme === item.id;
              return (
                <div
                  key={item.id}
                  onClick={() => setTheme(item.id)}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
                    isSelected
                      ? 'border-[var(--accent)] bg-[var(--bg-card)]'
                      : 'border-[var(--border)] hover:bg-[var(--bg-card)]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <Icon size={18} className={isSelected ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} />
                    {isSelected && <CheckCircle2 size={16} className="text-[var(--accent-green)]" />}
                  </div>
                  <p className="font-bold text-sm text-[var(--text-primary)]">{item.label}</p>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="pt-2 flex items-center justify-between text-xs">
          <div>
            <p className="font-semibold text-[var(--text-primary)]">Smooth Micro-interactions & Motion</p>
            <p className="text-[11px] text-[var(--text-muted)]">Enable subtle card transitions and chart animations</p>
          </div>
          <button
            onClick={() => setAnimationsEnabled(!animationsEnabled)}
            className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${
              animationsEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--bg-card)] border border-[var(--border)]'
            }`}
          >
            <div
              className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                animationsEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* 2. Map Preferences */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-[var(--border)]">
          <Map size={18} className="text-[var(--accent-green)]" />
          <h3 className="font-bold text-base text-[var(--text-primary)]">Geospatial & Map Settings</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="font-semibold text-[var(--text-secondary)] block mb-1.5">
              Default Tile Layer
            </label>
            <select
              value={defaultLayer}
              onChange={e => setDefaultLayer(e.target.value as 'satellite' | 'street')}
              className="input-base"
            >
              <option value="satellite">Esri World Imagery (Satellite)</option>
              <option value="street">OpenStreetMap Standard</option>
            </select>
          </div>

          <div>
            <label className="font-semibold text-[var(--text-secondary)] block mb-1.5">
              Temperature & Area Measurement Units
            </label>
            <select
              value={units}
              onChange={e => setUnits(e.target.value as any)}
              className="input-base"
            >
              <option value="metric">Metric (°C, Hectares, Kilometers)</option>
              <option value="imperial">Imperial (°F temperatures)</option>
            </select>
            <p className="text-[10px] text-[var(--text-muted)] mt-1">Reports and assistant answers stay in °C.</p>
          </div>
        </div>

        <div className="pt-3 border-t border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div>
            <p className="font-semibold text-[var(--text-primary)]">Analysis Area</p>
            <p className="text-[11px] text-[var(--text-muted)]">
              {areaData?.area.location ?? area.name ?? 'Loading…'} · {formatCoords(area.lat, area.lng)} · {area.widthKm} km wide.
              Change it from the Map Explorer search.
            </p>
          </div>
          <button
            onClick={() => { setArea(DEFAULT_AREA); toast('Analysing Shah Alam (default)…', { icon: '🛰️' }); }}
            className="btn-ghost text-xs py-1.5 px-3 shrink-0"
          >
            <RotateCcw size={13} /> Reset to default area
          </button>
        </div>
      </div>

      {/* 3. Assistant Preferences */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-[var(--border)]">
          <MessageSquare size={18} className="text-[var(--info)]" />
          <h3 className="font-bold text-base text-[var(--text-primary)]">AI Assistant Preferences</h3>
        </div>

        <div className="space-y-4 text-xs">
          <div>
            <label className="font-semibold text-[var(--text-secondary)] block mb-1.5">
              Assistant Response Style
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'concise', label: 'Concise Bulleted' },
                { id: 'scientific', label: 'Scientific & Contextual' },
                { id: 'strategic', label: 'Policy & Action-Oriented' },
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setResponseStyle(opt.id as AssistantStyle)}
                  className={`p-2.5 rounded-xl border text-xs font-semibold transition-all ${
                    responseStyle === opt.id
                      ? 'border-[var(--accent)] bg-[var(--bg-card)] text-[var(--accent-foreground)]'
                      : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)]'
                  }`}
                  style={responseStyle === opt.id ? { background: 'var(--accent)' } : {}}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2 flex items-center justify-between">
            <div>
              <p className="font-semibold text-[var(--text-primary)]">Global Right-Hand Chat Panel</p>
              <p className="text-[11px] text-[var(--text-muted)]">Keep assistant side panel expanded by default</p>
            </div>
            <button
              onClick={() => setChatVisible(!chatVisible)}
              className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${
                chatVisible ? 'bg-[var(--accent)]' : 'bg-[var(--bg-card)] border border-[var(--border)]'
              }`}
            >
              <div
                className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                  chatVisible ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="pt-3 border-t border-[var(--border)] flex items-center justify-between">
            <div>
              <p className="font-semibold text-[var(--alert-high)]">Clear Conversation History</p>
              <p className="text-[11px] text-[var(--text-muted)]">Erases stored questions and local dialogue cache</p>
            </div>
            <button
              onClick={handleClearChatHistory}
              className="btn-ghost text-[var(--alert-high)] hover:bg-red-500/10 py-1.5 px-3 text-xs flex items-center gap-1.5 font-semibold"
            >
              <Trash2 size={13} />
              Clear History
            </button>
          </div>
        </div>
      </div>

      {/* 4. Data Provenance & Attribution */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-[var(--border)]">
          <Database size={18} className="text-[var(--accent)]" />
          <h3 className="font-bold text-base text-[var(--text-primary)]">Data Sources & Provenance</h3>
        </div>

        <div className="space-y-3 text-xs text-[var(--text-secondary)] leading-relaxed">
          <div className="p-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] space-y-2">
            <p className="font-semibold text-[var(--text-primary)]">Configured Environmental Sensors</p>
            <p>• <strong>Sentinel-2A/B/C (MSI):</strong> Level-2A red and near-infrared bands (10 m) for NDVI vegetation coverage, and true-colour photos for the assistant (AWS Open Data).</p>
            <p>• <strong>Landsat 8/9 (TIRS):</strong> Collection 2 Level-2 surface temperature (30 m) for Land Surface Temperature (Microsoft Planetary Computer).</p>
            <p>• <strong>ESA WorldCover 2021:</strong> 10 m land-cover classes for built-up, tree, water and open ground.</p>
            <p>• <strong>Meta HRSL:</strong> 30 m population estimates for residents exposed to heat.</p>
            <p>• <strong>NASA POWER:</strong> climate normals, used only to estimate temperature when Landsat is unreachable.</p>
            <p>• <strong>OpenStreetMap / Esri:</strong> Place search, basemap vector geography and satellite tile attribution.</p>
          </div>

          {prov && (
            <div className="p-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] space-y-2">
              <p className="font-semibold text-[var(--text-primary)]">Current Analysis · {areaData?.area.name}</p>
              <div className="flex flex-wrap gap-2">
                <SourceBadge source={prov.surfaceTemp} />
                <SourceBadge source={prov.vegetation} />
              </div>
              <p>Temperature: {prov.surfaceTemp.sensor}{prov.surfaceTemp.dates.length ? ` — scenes ${prov.surfaceTemp.dates.map(formatDate).join(', ')}` : ''}</p>
              <p>Vegetation: {prov.vegetation.sensor}{prov.vegetation.kind === 'sentinel2' ? ` — scenes ${prov.vegetation.dates.map(formatDate).join(', ')}` : ''}</p>
              {prov.surfaceTemp.note && <p className="text-[var(--alert-medium)]">⚠ {prov.surfaceTemp.note}</p>}
              {areaData?.warnings.map(w => <p key={w} className="text-[var(--alert-medium)]">⚠ {w}</p>)}
            </div>
          )}

          <div className="badge-low !block !p-3 !rounded-xl !text-[11px] !font-normal">
            <strong>Live Data Notice:</strong> Heat and vegetation readings are computed from the satellite archives for the selected area each time it is analysed.
            They are screening results — ground-truthing is required before investment decisions.
          </div>
        </div>
      </div>

      {/* 5. Account & Reset */}
      <div className="card p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center bg-[var(--bg-card)] border border-[var(--border)]">
            <User size={22} className="text-[var(--text-primary)]" />
          </div>
          <div>
            <h4 className="font-bold text-sm text-[var(--text-primary)]">Local Environmental Analyst</h4>
            <p className="text-xs text-[var(--text-muted)]">Climate Resilience & Urban Forestry Office</p>
          </div>
        </div>

        <button
          onClick={handleResetPreferences}
          className="btn-ghost text-xs py-2 px-3 flex items-center gap-1.5 font-semibold"
        >
          <RotateCcw size={14} />
          Reset All Settings
        </button>
      </div>
    </div>
  );
}
