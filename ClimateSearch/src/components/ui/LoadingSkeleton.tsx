import { cn } from '@/lib/utils';

interface SkeletonProps { className?: string; }

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div className={cn(
      'animate-pulse rounded-md bg-[var(--bg-card)]',
      className
    )} />
  );
}

export function MetricCardSkeleton() {
  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Skeleton className="w-9 h-9 rounded-xl" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="h-9 w-32" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}
