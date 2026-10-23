import { useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell, HelpCircle, User, Search, X, Sparkles,
  MapPin, Flame, Sprout, FileText
} from 'lucide-react';
import toast from 'react-hot-toast';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useAppStore } from '@/store';
import { api, type PlaceResult } from '@/services/api';
import { formatTemp, formatTimestamp } from '@/lib/utils';
import type { ClimateZone, GreeningCandidate, Hotspot } from '@/types';

type SearchHit =
  | { type: 'zone'; item: ClimateZone; title: string; subtitle: string }
  | { type: 'hotspot'; item: Hotspot; title: string; subtitle: string }
  | { type: 'greening'; item: GreeningCandidate; title: string; subtitle: string }
  | { type: 'place'; item: PlaceResult; title: string; subtitle: string };

const TOP_PILLS = [
  { to: '/overview', label: 'Overview' },
  { to: '/hotspots', label: 'Hotspots' },
  { to: '/greening', label: 'Greening' },
  { to: '/reports', label: 'Reports' },
];

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  const {
    notifications, markNotificationRead, markAllNotificationsRead,
    chatVisible, toggleChat,
    setSelectedZone, setSelectedHotspot, setSelectedCandidate, setMapView,
    areaData, area, setArea,
  } = useAppStore();

  const [notifOpen, setNotifOpen] = useState(false);
  const [searchVal, setSearchVal] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [places, setPlaces] = useState<PlaceResult[]>([]);
  const notifRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const unread = notifications.filter(n => !n.read).length;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Places anywhere (OpenStreetMap), looked up after a short pause in typing
  useEffect(() => {
    const q = searchVal.trim();
    if (q.length < 3) {
      setPlaces([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.searchPlaces(q).then(found => !cancelled && setPlaces(found.slice(0, 3))).catch(() => !cancelled && setPlaces([]));
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [searchVal]);

  // Search filtered results: things in the analysed area first, then places to analyse
  const q = searchVal.trim().toLowerCase();
  const matchingResults: SearchHit[] = q
    ? [
        ...[
          ...(areaData?.zones ?? [])
            .filter(z => z.name.toLowerCase().includes(q))
            .map(z => ({ type: 'zone' as const, item: z, title: z.name, subtitle: `Zone • ${z.location}` })),
          ...(areaData?.hotspots ?? [])
            .filter(h => h.name.toLowerCase().includes(q))
            .map(h => ({ type: 'hotspot' as const, item: h, title: h.name, subtitle: `Hotspot • ${formatTemp(h.surfaceTemp)}` })),
          ...(areaData?.greeningCandidates ?? [])
            .filter(g => g.name.toLowerCase().includes(q))
            .map(g => ({ type: 'greening' as const, item: g, title: g.name, subtitle: `Greening • ${g.candidateArea} ha` })),
        ].slice(0, 4),
        ...places.map(p => ({ type: 'place' as const, item: p, title: p.name, subtitle: `Analyse place • ${p.detail}` })),
      ]
    : [];

  const handleSelectSearchItem = (res: SearchHit) => {
    setSearchVal('');
    setSearchFocused(false);
    if (res.type === 'zone') {
      setSelectedZone(res.item);
      setMapView(res.item.coordinates, 14);
      navigate('/map-explorer');
    } else if (res.type === 'hotspot') {
      setSelectedHotspot(res.item);
      navigate('/hotspots');
    } else if (res.type === 'greening') {
      setSelectedCandidate(res.item);
      navigate('/greening');
    } else {
      setArea({ lat: res.item.lat, lng: res.item.lon, widthKm: area.widthKm, name: res.item.name, location: res.item.detail });
      toast(`Analysing ${res.item.name}…`, { icon: '🛰️' });
    }
  };

  return (
    <header
      className="flex items-center justify-between gap-3 px-4 py-2.5 shrink-0 z-30"
      style={{ background: 'var(--bg-sidebar)', borderBottom: '1px solid var(--border)' }}
    >
      {/* Left: Mobile Title or Breadcrumb */}
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold text-[var(--text-primary)] hidden sm:block">
          {title}
        </h1>
      </div>

      {/* Center: Top Navigation Pills (matches design reference) */}
      <nav className="hidden md:flex items-center p-1 rounded-full border border-[var(--border)] bg-[var(--bg-card)]">
        {TOP_PILLS.map(pill => {
          const isActive = location.pathname === pill.to;
          return (
            <NavLink
              key={pill.to}
              to={pill.to}
              className={`px-4 py-1 rounded-full text-xs font-semibold transition-all ${
                isActive
                  ? 'bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {pill.label}
            </NavLink>
          );
        })}
      </nav>

      {/* Right: Search, Chat Toggle, Theme, Notifications, Profile */}
      <div className="flex items-center gap-2">
        {/* Global Search Bar */}
        <div ref={searchRef} className="relative w-40 sm:w-56">
          <div className="flex items-center gap-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-full px-3 py-1.5 focus-within:border-[var(--accent)] transition-all">
            <Search size={13} className="text-[var(--text-muted)] shrink-0" />
            <input
              type="text"
              value={searchVal}
              onChange={e => setSearchVal(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onKeyDown={e => e.key === 'Enter' && matchingResults[0] && handleSelectSearchItem(matchingResults[0])}
              placeholder="Search zones or places…"
              className="bg-transparent text-xs w-full outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
            {searchVal && (
              <button onClick={() => setSearchVal('')}>
                <X size={12} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" />
              </button>
            )}
          </div>

          <AnimatePresence>
            {searchFocused && matchingResults.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="absolute right-0 top-10 w-72 rounded-xl shadow-2xl border border-[var(--border)] bg-[var(--bg-panel)] overflow-hidden z-50 divide-y divide-[var(--border)]"
              >
                {matchingResults.map((r, i) => (
                  <div
                    key={i}
                    onClick={() => handleSelectSearchItem(r)}
                    className="p-3 cursor-pointer hover:bg-[var(--bg-card)] flex items-center gap-2.5 transition-colors"
                  >
                    <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-[var(--bg-card)] text-[var(--accent)]">
                      {r.type === 'zone' && <MapPin size={13} />}
                      {r.type === 'hotspot' && <Flame size={13} className="text-red-400" />}
                      {r.type === 'greening' && <Sprout size={13} className="text-lime-400" />}
                      {r.type === 'place' && <Search size={13} />}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-[var(--text-primary)]">{r.title}</p>
                      <p className="text-[10px] text-[var(--text-muted)]">{r.subtitle}</p>
                    </div>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* AI Assistant Toggle Button */}
        <button
          onClick={toggleChat}
          className={`btn-ghost h-8 px-2.5 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
            chatVisible ? 'border-[var(--accent)] text-[var(--accent)]' : ''
          }`}
          title="Toggle Assistant"
          aria-label="Toggle Climate Assistant"
        >
          <Sparkles size={14} className="text-[var(--accent)]" />
          <span className="hidden xl:inline">{chatVisible ? 'Hide AI' : 'AI Assistant'}</span>
        </button>

        {/* Theme Toggle */}
        <ThemeToggle />

        {/* Notifications */}
        <div ref={notifRef} className="relative">
          <button
            onClick={() => setNotifOpen(p => !p)}
            className="btn-ghost w-8 h-8 p-0 justify-center rounded-full relative"
            aria-label={`Notifications — ${unread} unread`}
          >
            <Bell size={15} />
            {unread > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[var(--alert-high)]" />
            )}
          </button>

          <AnimatePresence>
            {notifOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-10 w-80 z-50 card overflow-hidden shadow-2xl rounded-2xl"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
                  <span className="text-xs font-bold text-[var(--text-primary)]">Platform Notifications</span>
                  {unread > 0 && (
                    <button
                      onClick={markAllNotificationsRead}
                      className="text-[11px] text-[var(--accent-green)] hover:underline font-semibold"
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-[var(--border)] text-xs">
                  {notifications.length === 0 && (
                    <p className="p-4 text-center text-[var(--text-muted)]">No notifications yet — they arrive with each area analysis.</p>
                  )}
                  {notifications.map(n => (
                    <div
                      key={n.id}
                      onClick={() => {
                        markNotificationRead(n.id);
                        if (n.route) navigate(n.route);
                        setNotifOpen(false);
                      }}
                      className="flex items-start gap-3 p-3.5 cursor-pointer hover:bg-[var(--bg-card)] transition-colors"
                    >
                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                        n.type === 'warning' ? 'bg-[var(--alert-medium)]' :
                        n.type === 'error' ? 'bg-[var(--alert-high)]' :
                        n.type === 'success' ? 'bg-[var(--alert-low)]' : 'bg-[var(--info)]'
                      } ${n.read ? 'opacity-30' : ''}`} />
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold ${n.read ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
                          {n.title}
                        </p>
                        <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{n.message}</p>
                        <p className="text-[10px] text-[var(--text-muted)] mt-1 font-mono">{formatTimestamp(n.timestamp)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* User Profile Avatar */}
        <div
          onClick={() => navigate('/settings')}
          className="w-8 h-8 rounded-full flex items-center justify-center cursor-pointer border border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--accent)] transition-colors"
          title="Account Settings"
        >
          <User size={15} className="text-[var(--text-secondary)]" />
        </div>
      </div>
    </header>
  );
}
