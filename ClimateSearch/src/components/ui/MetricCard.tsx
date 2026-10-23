import { motion } from 'framer-motion';
import { Info, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ClimateMetric } from '@/types';

interface MetricCardProps {
  metric: ClimateMetric;
  icon: React.ReactNode;
  className?: string;
  delay?: number;
}

export function MetricCard({ metric, icon, className, delay = 0 }: MetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay }}
      className={cn('card p-5 flex flex-col gap-3', className)}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-[var(--bg-card)]">
            {icon}
          </div>
          <span className="text-sm font-medium text-[var(--text-secondary)] leading-tight max-w-[120px]">
            {metric.label}
          </span>
        </div>
        <div className="group relative">
          <Info size={14} className="text-[var(--text-muted)] cursor-help" />
          <div className="absolute right-0 top-5 z-10 hidden group-hover:block w-56 p-2.5 text-xs text-[var(--text-secondary)] bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-lg">
            <p>{metric.description}</p>
            {metric.isDemo && <p className="mt-1 text-[var(--text-muted)]">⚠ {metric.dataSource}</p>}
          </div>
        </div>
      </div>

      <div className="flex items-end justify-between">
        <div>
          <span className="text-3xl font-bold text-[var(--text-primary)]">
            {metric.value}
          </span>
          <span className="text-lg text-[var(--text-secondary)] ml-1">{metric.unit}</span>
        </div>
        {metric.trend && (
          <div className={cn(
            'flex items-center gap-1 text-xs font-medium',
            metric.trend === 'up' ? 'text-[var(--alert-high)]' : '',
            metric.trend === 'down' ? 'text-[var(--alert-low)]' : '',
            metric.trend === 'stable' ? 'text-[var(--text-muted)]' : '',
          )}>
            {metric.trend === 'up' && <TrendingUp size={13} />}
            {metric.trend === 'down' && <TrendingDown size={13} />}
            {metric.trend === 'stable' && <Minus size={13} />}
            {metric.trendValue !== undefined && (
              <span>{metric.trend === 'up' ? '+' : metric.trend === 'down' ? '-' : ''}{metric.trendValue}{metric.unit === '%' ? 'pp' : metric.unit === '°C' ? '°C' : ''}</span>
            )}
          </div>
        )}
      </div>

      {metric.trendPeriod && (
        <p className="text-xs text-[var(--text-muted)]">{metric.trendPeriod}</p>
      )}

      {metric.isDemo && (
        <span className="text-[10px] text-[var(--text-muted)] italic">Sample data</span>
      )}
    </motion.div>
  );
}
