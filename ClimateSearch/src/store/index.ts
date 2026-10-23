import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Theme,
  MapLayerId,
  MapLayer,
  ChatMessage,
  ChatContext,
  LatLng,
  Hotspot,
  GreeningCandidate,
  ClimateZone,
  Notification,
  SearchResult,
} from '@/types';
import { demoNotifications } from '@/data/demo';

interface AppState {
  // Theme
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'light' | 'dark';

  // Sidebar
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;

  // Map
  mapCenter: LatLng;
  mapZoom: number;
  setMapCenter: (center: LatLng) => void;
  setMapZoom: (zoom: number) => void;
  setMapView: (center: LatLng, zoom: number) => void;
  mapLayers: MapLayer[];
  toggleLayer: (id: MapLayerId) => void;
  setLayerOpacity: (id: MapLayerId, opacity: number) => void;

  // Selected items
  selectedZone: ClimateZone | null;
  selectedHotspot: Hotspot | null;
  selectedCandidate: GreeningCandidate | null;
  setSelectedZone: (zone: ClimateZone | null) => void;
  setSelectedHotspot: (hotspot: Hotspot | null) => void;
  setSelectedCandidate: (candidate: GreeningCandidate | null) => void;

  // Chat
  chatVisible: boolean;
  chatMessages: ChatMessage[];
  chatContext: ChatContext;
  setChatVisible: (visible: boolean) => void;
  toggleChat: () => void;
  addChatMessage: (msg: ChatMessage) => void;
  updateChatMessage: (id: string, updates: Partial<ChatMessage>) => void;
  clearChat: () => void;
  setChatContext: (ctx: Partial<ChatContext>) => void;

  // Notifications
  notifications: Notification[];
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;

  // Search
  searchQuery: string;
  searchResults: SearchResult[];
  setSearchQuery: (q: string) => void;
  setSearchResults: (results: SearchResult[]) => void;

  // Preferences
  units: 'metric' | 'imperial';
  setUnits: (units: 'metric' | 'imperial') => void;
}

const DEFAULT_LAYERS: MapLayer[] = [
  { id: 'satellite', label: 'Satellite Imagery', description: 'Base satellite map', enabled: true, opacity: 1 },
  { id: 'temperature', label: 'Surface Temperature', description: 'Heat overlay', enabled: true, opacity: 0.7 },
  { id: 'vegetation', label: 'Vegetation Index', description: 'NDVI overlay', enabled: false, opacity: 0.7 },
  { id: 'hotspots', label: 'Hotspot Markers', description: 'Hotspot locations', enabled: true, opacity: 1 },
  { id: 'greenspaces', label: 'Parks & Green Spaces', description: 'Existing green spaces', enabled: false, opacity: 0.6 },
  { id: 'boundaries', label: 'Admin Boundaries', description: 'Administrative boundaries', enabled: false, opacity: 0.5 },
];

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Theme
      theme: 'dark',
      resolvedTheme: 'dark',
      setTheme: (theme) => {
        const resolved = theme === 'system'
          ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
          : theme;
        set({ theme, resolvedTheme: resolved as 'light' | 'dark' });
        document.documentElement.classList.toggle('dark', resolved === 'dark');
      },

      // Sidebar
      sidebarCollapsed: false,
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      // Map
      mapCenter: { lat: 6.3244, lng: 3.3792 },
      mapZoom: 12,
      setMapCenter: (center) => set({ mapCenter: center }),
      setMapZoom: (zoom) => set({ mapZoom: zoom }),
      setMapView: (center, zoom) => set({ mapCenter: center, mapZoom: zoom }),
      mapLayers: DEFAULT_LAYERS,
      toggleLayer: (id) => set(s => ({
        mapLayers: s.mapLayers.map(l => l.id === id ? { ...l, enabled: !l.enabled } : l)
      })),
      setLayerOpacity: (id, opacity) => set(s => ({
        mapLayers: s.mapLayers.map(l => l.id === id ? { ...l, opacity } : l)
      })),

      // Selected items
      selectedZone: null,
      selectedHotspot: null,
      selectedCandidate: null,
      setSelectedZone: (zone) => set({ selectedZone: zone }),
      setSelectedHotspot: (hotspot) => set({ selectedHotspot: hotspot }),
      setSelectedCandidate: (candidate) => set({ selectedCandidate: candidate }),

      // Chat
      chatVisible: true,
      chatMessages: [],
      chatContext: {},
      setChatVisible: (visible) => set({ chatVisible: visible }),
      toggleChat: () => set(s => ({ chatVisible: !s.chatVisible })),
      addChatMessage: (msg) => set(s => ({ chatMessages: [...s.chatMessages, msg] })),
      updateChatMessage: (id, updates) => set(s => ({
        chatMessages: s.chatMessages.map(m => m.id === id ? { ...m, ...updates } : m)
      })),
      clearChat: () => set({ chatMessages: [] }),
      setChatContext: (ctx) => set(s => ({ chatContext: { ...s.chatContext, ...ctx } })),

      // Notifications
      notifications: demoNotifications,
      markNotificationRead: (id) => set(s => ({
        notifications: s.notifications.map(n => n.id === id ? { ...n, read: true } : n)
      })),
      markAllNotificationsRead: () => set(s => ({
        notifications: s.notifications.map(n => ({ ...n, read: true }))
      })),

      // Search
      searchQuery: '',
      searchResults: [],
      setSearchQuery: (q) => set({ searchQuery: q }),
      setSearchResults: (results) => set({ searchResults: results }),

      // Preferences
      units: 'metric',
      setUnits: (units) => set({ units }),
    }),
    {
      name: 'climatesmart-prefs',
      partialize: (state) => ({
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
        chatVisible: state.chatVisible,
        mapLayers: state.mapLayers,
        units: state.units,
      }),
    }
  )
);
