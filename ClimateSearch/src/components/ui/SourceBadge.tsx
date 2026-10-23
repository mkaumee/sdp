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
        estimate ? 'badge-medium' : 'badge-low',  // tinted background, same as the severity badges
        'inline-flex items-center gap-1 !text-[11px] font-semibold',
        className,
      )}
    >
      {estimate ? <AlertTriangle size={11} /> : <Satellite size={11} />}
      {source.label}
    </span>
  );
}
