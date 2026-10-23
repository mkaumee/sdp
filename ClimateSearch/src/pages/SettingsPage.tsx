import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Settings, Sun, Moon, Monitor, Map, MessageSquare,
  Database, User, Shield, Trash2, CheckCircle2, RotateCcw,
  Sparkles, ExternalLink
} from 'lucide-react';
import { useAppStore } from '@/store';
import type { Theme } from '@/types';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const {
    theme, setTheme,
    units, setUnits,
    chatVisible, setChatVisible,
    clearChat
  } = useAppStore();

  const [responseStyle, setResponseStyle] = useState<'concise' | 'scientific' | 'strategic'>('scientific');
  const [defaultLayer, setDefaultLayer] = useState<'satellite' | 'street'>('satellite');
  const [animationsEnabled, setAnimationsEnabled] = useState(true);

  const handleClearChatHistory = () => {
    clearChat();
    toast.success('Assistant conversation history cleared');
  };

  const handleResetPreferences = () => {
    setTheme('dark');
    setUnits('metric');
    setChatVisible(true);
    setResponseStyle('scientific');
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
            onClick={() => setAnimationsEnabled(p => !p)}
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
              onChange={e => setDefaultLayer(e.target.value as any)}
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
              <option value="imperial">Imperial (°F, Acres, Miles)</option>
            </select>
          </div>
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
                  onClick={() => setResponseStyle(opt.id as any)}
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
            <p>• <strong>Sentinel-2A (MSI):</strong> Multispectral imaging for NDVI vegetation coverage calculation.</p>
            <p>• <strong>Landsat-9 (TIRS-2):</strong> Thermal Infrared Sensor Band 10 for Land Surface Temperature derivation.</p>
            <p>• <strong>OpenStreetMap / Esri:</strong> Basemap vector geography and satellite tile attribution.</p>
          </div>

          <div className="p-3 rounded-xl bg-[var(--alert-medium)] bg-opacity-10 border border-[var(--alert-medium)] border-opacity-30 text-[11px] text-[var(--alert-medium)]">
            <strong>Demonstration Dataset Notice:</strong> This installation runs in demonstrative evaluation mode. Satellite imagery tiles are live; numerical heat and canopy readings for Lagos metropolitan zones represent illustrative sample data.
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
