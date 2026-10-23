import { type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MobileNav } from './MobileNav';

interface AppLayoutProps {
  children: ReactNode;
  title: string;
  rightPanel?: ReactNode;
  fullHeight?: boolean;
}

export function AppLayout({ children, title, rightPanel, fullHeight }: AppLayoutProps) {
  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ background: 'var(--bg-main)' }}>
      {/* Sidebar */}
      <Sidebar />

      {/* Main column */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header title={title} />

        <div className="flex flex-1 overflow-hidden">
          {/* Page content */}
          <motion.main
            key={title}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
            className={`flex-1 overflow-y-auto min-w-0 ${fullHeight ? 'overflow-hidden' : ''}`}
          >
            {children}
          </motion.main>

          {/* Right panel (chat) */}
          {rightPanel}
        </div>

        <MobileNav />
      </div>
    </div>
  );
}
