import { type ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Satellite } from 'lucide-react';
import { useAppStore } from '@/store';
import { formatCoords } from '@/lib/utils';
import type { AreaData } from '@/types';

// What the backend downloads for every area (shown while it works).
const STEPS = [
  'Landsat 8/9 thermal band — surface temperature',
  'Sentinel-2 red & near-infrared bands — vegetation (NDVI)',
  'ESA WorldCover — land cover',
  'Meta HRSL — where people live',
];

/** Shows a loading or error screen until the live analysis of the selected area has arrived. */
export function AreaGate({ children }: { children: (data: AreaData) => ReactNode }) {
  const { area, areaData, areaStatus, areaError, loadArea } = useAppStore();
  if (areaData) return <>{children(areaData)}</>;

  const place = area.name ?? formatCoords(area.lat, area.lng);

  if (areaStatus === 'error') {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <div className="card p-6 flex flex-col items-center text-center gap-3">
          <AlertTriangle size={28} className="text-[var(--alert-high)]" />
          <h3 className="text-base font-bold text-[var(--text-primary)]">Could not analyse {place}</h3>
          <p className="text-sm text-[var(--text-secondary)]">{areaError}</p>
          <p className="text-xs text-[var(--text-muted)]">
            The dashboard needs the ClimateSmart AI server (<code>python app.py</code>) and access to the AWS Open Data satellite archives.
          </p>
          <button onClick={() => loadArea()} className="btn-primary text-xs py-2 px-4 mt-1">
            <RotateCcw size={14} /> Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-xl mx-auto" role="status" aria-live="polite">
      <div className="card p-6 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--bg-card)] text-[var(--accent)]">
            <Satellite size={20} className="animate-pulse" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[var(--text-primary)]">Analysing {place}</h3>
            <p className="text-xs text-[var(--text-muted)]">{area.widthKm} km × {area.widthKm} km · {formatCoords(area.lat, area.lng)}</p>
          </div>
        </div>
        <ul className="space-y-2">
          {STEPS.map(step => (
            <li key={step} className="flex items-center gap-2.5 text-xs text-[var(--text-secondary)]">
              <span className="w-3.5 h-3.5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin shrink-0" />
              {step}
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-[var(--text-muted)]">
          The first look at an area downloads fresh satellite scenes and takes about 10–30 seconds; after that it's instant.
        </p>
      </div>
    </div>
  );
}
