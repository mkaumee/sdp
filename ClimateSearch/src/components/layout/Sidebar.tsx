import { NavLink } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Map, Flame, Sprout, FileText, Settings,
  ChevronLeft, ChevronRight, Leaf
} from 'lucide-react';
import { useAppStore } from '@/store';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { to: '/overview', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/map-explorer', icon: Map, label: 'Map Explorer' },
  { to: '/hotspots', icon: Flame, label: 'Hotspots' },
  { to: '/greening', icon: Sprout, label: 'Greening' },
  { to: '/reports', icon: FileText, label: 'Reports' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useAppStore();

  return (
    <motion.aside
      initial={false}
      animate={{ width: sidebarCollapsed ? 64 : 220 }}
      transition={{ duration: 0.25, ease: 'easeInOut' }}
      className="hidden md:flex flex-col h-full overflow-hidden shrink-0"
      style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border)' }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 py-5 shrink-0">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'var(--accent)' }}>
          <Leaf size={16} style={{ color: 'var(--accent-foreground)' }} />
        </div>
        <AnimatePresence>
          {!sidebarCollapsed && (
            <motion.span
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.18 }}
              className="font-bold text-sm whitespace-nowrap"
              style={{ color: 'var(--text-primary)' }}
            >
              ClimateSmart AI
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-2 flex flex-col gap-1 overflow-y-auto py-2">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            title={sidebarCollapsed ? label : undefined}
            className={({ isActive }) => cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 group relative',
              isActive
                ? 'text-[var(--accent-foreground)] font-semibold'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
            )}
            style={({ isActive }) => isActive ? { background: 'var(--accent)', color: 'var(--accent-foreground)' } : {}}
          >
            <Icon size={18} className="shrink-0" />
            <AnimatePresence>
              {!sidebarCollapsed && (
                <motion.span
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -6 }}
                  transition={{ duration: 0.15 }}
                  className="whitespace-nowrap overflow-hidden"
                >
                  {label}
                </motion.span>
              )}
            </AnimatePresence>
          </NavLink>
        ))}
      </nav>

      {/* Mission statement + collapse toggle */}
      <div className="p-3 shrink-0 flex flex-col gap-2">
        <AnimatePresence>
          {!sidebarCollapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-3 rounded-xl text-xs leading-relaxed"
              style={{ background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
            >
              <span style={{ color: 'var(--accent-green)' }}>🌿</span>{' '}
              A greener tomorrow starts with data.
            </motion.div>
          )}
        </AnimatePresence>
        <button
          onClick={toggleSidebar}
          className="btn-ghost w-full justify-center py-2 text-xs"
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? <ChevronRight size={16} /> : <><ChevronLeft size={16} /><span>Collapse</span></>}
        </button>
      </div>
    </motion.aside>
  );
}
