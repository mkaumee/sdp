import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Map, Flame, Sprout, FileText } from 'lucide-react';

const MOBILE_NAV = [
  { to: '/overview', icon: LayoutDashboard, label: 'Overview' },
  { to: '/map-explorer', icon: Map, label: 'Map' },
  { to: '/hotspots', icon: Flame, label: 'Hotspots' },
  { to: '/greening', icon: Sprout, label: 'Greening' },
  { to: '/reports', icon: FileText, label: 'Reports' },
];

export function MobileNav() {
  return (
    <nav
      className="md:hidden flex items-center justify-around py-2 shrink-0"
      style={{ background: 'var(--bg-sidebar)', borderTop: '1px solid var(--border)' }}
    >
      {MOBILE_NAV.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-[10px] font-medium transition-colors ${
              isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon size={20} style={isActive ? { color: 'var(--accent)' } : {}} />
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
