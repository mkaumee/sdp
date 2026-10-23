import { cn } from '@/lib/utils';
import type { Severity } from '@/types';

interface BadgeProps {
  severity?: Severity;
  variant?: 'high' | 'medium' | 'low' | 'info' | 'default';
  children: React.ReactNode;
  className?: string;
}

export function Badge({ severity, variant, children, className }: BadgeProps) {
  const v = severity ?? variant ?? 'default';
  return (
    <span className={cn(
      v === 'high' && 'badge-high',
      v === 'medium' && 'badge-medium',
      v === 'low' && 'badge-low',
      v === 'info' && 'badge-info',
      v === 'default' && 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border)]',
      'inline-flex items-center gap-1',
      className
    )}>
      {children}
    </span>
  );
}
