import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Severity } from '@/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTemp(value: number | null | undefined, units: 'metric' | 'imperial' = 'metric'): string {
  if (value === null || value === undefined) return '–';  // no temperature source was reachable
  if (units === 'imperial') {
    return `${((value * 9) / 5 + 32).toFixed(1)}°F`;
  }
  return `${value.toFixed(1)}°C`;
}

export function formatPercent(value: number): string {
  return `${value}%`;
}

export function formatArea(value: number): string {
  return `${value.toFixed(1)} ha`;
}

export function getSeverityLabel(severity: Severity): string {
  return { high: 'High', medium: 'Medium', low: 'Low' }[severity];
}

export function getSeverityColor(severity: Severity): string {
  return {
    high: 'var(--alert-high)',
    medium: 'var(--alert-medium)',
    low: 'var(--alert-low)',
  }[severity];
}

export function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/** "3.1885° N, 101.4930° E" */
export function formatCoords(lat: number, lng: number, digits = 4): string {
  return `${Math.abs(lat).toFixed(digits)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(digits)}° ${lng >= 0 ? 'E' : 'W'}`;
}

/** Average of the numbers that are present (null when there are none). */
export function average(values: (number | null | undefined)[]): number | null {
  const known = values.filter((v): v is number => typeof v === 'number');
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
}

export function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

export function getStatusVariant(status: string): string {
  const map: Record<string, string> = {
    identified: 'info',
    'under-review': 'medium',
    approved: 'low',
    'in-progress': 'info',
    completed: 'low',
    draft: 'medium',
    generating: 'info',
    ready: 'low',
    failed: 'high',
  };
  return map[status] ?? 'info';
}

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
