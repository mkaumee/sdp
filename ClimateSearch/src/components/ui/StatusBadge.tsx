import { cn } from '@/lib/utils';

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  identified: { label: 'Identified', cls: 'badge-info' },
  'under-review': { label: 'Under Review', cls: 'badge-medium' },
  approved: { label: 'Approved', cls: 'badge-low' },
  'in-progress': { label: 'In Progress', cls: 'badge-info' },
  completed: { label: 'Completed', cls: 'badge-low' },
  draft: { label: 'Draft', cls: 'badge-medium' },
  generating: { label: 'Generating...', cls: 'badge-info' },
  ready: { label: 'Ready', cls: 'badge-low' },
  failed: { label: 'Failed', cls: 'badge-high' },
};

export function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_MAP[status] ?? { label: status, cls: 'badge-info' };
  return <span className={cn(cfg.cls, 'capitalize')}>{cfg.label}</span>;
}
