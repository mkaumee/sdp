import { Satellite, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SourceInfo } from '@/types';

/** Says where a layer's numbers came from: a satellite scene (green) or an estimate (amber). */
export function SourceBadge({ source, className }: { source: SourceInfo; className?: string }) {
  const estimate = source.isEstimate || source.kind === 'none';
  return (
    <span
      title={[source.sensor, source.note].filter(Boolean).join(' — ')}
      className={cn(
        'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-semibold border',
        estimate
          ? 'text-[var(--alert-medium)] bg-[var(--alert-medium)] bg-opacity-15 border-[var(--alert-medium)] border-opacity-30'
          : 'text-[var(--alert-low)] bg-[var(--alert-low)] bg-opacity-15 border-[var(--alert-low)] border-opacity-30',
        className,
      )}
    >
      {estimate ? <AlertTriangle size={11} /> : <Satellite size={11} />}
      {source.label}
    </span>
  );
}
