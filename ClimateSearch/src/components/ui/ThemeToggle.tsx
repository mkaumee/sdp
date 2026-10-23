import { Sun, Moon, Monitor } from 'lucide-react';
import { useAppStore } from '@/store';
import type { Theme } from '@/types';

export function ThemeToggle() {
  const { theme, setTheme } = useAppStore();

  const cycle = () => {
    const next: Record<Theme, Theme> = { light: 'dark', dark: 'system', system: 'light' };
    setTheme(next[theme]);
  };

  return (
    <button
      onClick={cycle}
      className="btn-ghost w-9 h-9 p-0 justify-center rounded-lg"
      aria-label={`Current theme: ${theme}. Click to change.`}
      title={`Theme: ${theme}`}
    >
      {theme === 'light' && <Sun size={16} />}
      {theme === 'dark' && <Moon size={16} />}
      {theme === 'system' && <Monitor size={16} />}
    </button>
  );
}
