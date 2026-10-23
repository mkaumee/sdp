import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-12 px-4 text-center', className)}>
      {icon && <div className="text-[var(--text-muted)]">{icon}</div>}
      <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
      {description && <p className="text-sm text-[var(--text-muted)] max-w-xs">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
