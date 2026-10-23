import { useEffect, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAppStore } from '@/store';
import { AppLayout } from '@/components/layout/AppLayout';
import { ChatPanel } from '@/components/chat/ChatPanel';

// Lazy loaded pages for performance
const OverviewPage = lazy(() => import('@/pages/OverviewPage'));
const MapExplorerPage = lazy(() => import('@/pages/MapExplorerPage'));
const HotspotsPage = lazy(() => import('@/pages/HotspotsPage'));
const GreeningPage = lazy(() => import('@/pages/GreeningPage'));
const ReportsPage = lazy(() => import('@/pages/ReportsPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));

const PAGE_TITLES: Record<string, string> = {
  '/overview': 'Overview Dashboard',
  '/map-explorer': 'Map Explorer',
  '/hotspots': 'Urban Heat Hotspots',
  '/greening': 'Greening Opportunities',
  '/reports': 'Climate Reports',
  '/settings': 'System Settings',
};

function PageLoader() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 p-12 text-[var(--text-secondary)]">
      <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      <p className="text-xs font-medium">Loading climate workspace…</p>
    </div>
  );
}

function PageWrapper({ element, path }: { element: JSX.Element; path: string }) {
  const title = PAGE_TITLES[path] ?? 'ClimateSmart AI';
  const isMap = path === '/map-explorer';

  return (
    <AppLayout title={title} rightPanel={<ChatPanel />} fullHeight={isMap}>
      <Suspense fallback={<PageLoader />}>
        {element}
      </Suspense>
    </AppLayout>
  );
}

export default function App() {
  const { theme, setTheme, setChatContext } = useAppStore();
  const location = useLocation();

  useEffect(() => {
    setTheme(theme);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (theme === 'system') setTheme('system');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme, setTheme]);

  // Keep chat context updated with active route
  useEffect(() => {
    setChatContext({ route: location.pathname });
  }, [location.pathname, setChatContext]);

  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<PageWrapper element={<OverviewPage />} path="/overview" />} />
        <Route path="/map-explorer" element={<PageWrapper element={<MapExplorerPage />} path="/map-explorer" />} />
        <Route path="/hotspots" element={<PageWrapper element={<HotspotsPage />} path="/hotspots" />} />
        <Route path="/greening" element={<PageWrapper element={<GreeningPage />} path="/greening" />} />
        <Route path="/reports" element={<PageWrapper element={<ReportsPage />} path="/reports" />} />
        <Route path="/settings" element={<PageWrapper element={<SettingsPage />} path="/settings" />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>

      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'var(--bg-panel)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            fontSize: '13px',
            boxShadow: 'var(--shadow-lg)',
          },
        }}
      />
    </>
  );
}
