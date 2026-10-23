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
  AreaSelection,
  AreaData,
  AssistantStyle,
  Report,
} from '@/types';
import { api } from '@/services/api';
import { setDisplayUnits } from '@/lib/utils';

// Area analysed when the app first opens: Shah Alam (Selangor, Malaysia), around the City of Elmina townships.
export const DEFAULT_AREA: AreaSelection = {
  lat: 3.1885, lng: 101.493, widthKm: 10, name: 'Shah Alam', location: 'City of Elmina, Shah Alam, Selangor, Malaysia',
};

let inflight: AbortController | null = null;  // the area request in progress (a newer one cancels it)

/** Map zoom that fits an area of this width (10 km -> 13). */
export function zoomForWidth(widthKm: number) {
  return Math.round(13 - Math.log2(widthKm / 10));
}

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
  baseMap: 'satellite' | 'street';
  setBaseMap: (baseMap: 'satellite' | 'street') => void;
  animationsEnabled: boolean;
  setAnimationsEnabled: (enabled: boolean) => void;

  // Live analysis of the selected area (from the backend)
  area: AreaSelection;
  areaData: AreaData | null;
  areaStatus: 'idle' | 'loading' | 'ready' | 'error';
  areaError: string | null;
  setArea: (area: AreaSelection) => void;
  loadArea: () => Promise<void>;

  // Assistant & reports
  responseStyle: AssistantStyle;
  setResponseStyle: (style: AssistantStyle) => void;
  reports: Report[];
  addReport: (report: Report) => void;
}

const DEFAULT_LAYERS: MapLayer[] = [
  { id: 'satellite', label: 'Satellite Imagery', description: 'Base satellite map', enabled: true, opacity: 1 },
  { id: 'temperature', label: 'Surface Temperature', description: 'Heat overlay', enabled: true, opacity: 0.7 },
  { id: 'vegetation', label: 'Vegetation Index', description: 'NDVI overlay', enabled: false, opacity: 0.7 },
  { id: 'hotspots', label: 'Hotspot Markers', description: 'Hotspot locations', enabled: true, opacity: 1 },
  { id: 'greenspaces', label: 'Parks & Green Spaces', description: 'Well-vegetated cells & greening sites', enabled: false, opacity: 0.6 },
  { id: 'boundaries', label: 'Zone Boundaries', description: '3 × 3 analysis zones', enabled: false, opacity: 0.5 },
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
      mapCenter: { lat: DEFAULT_AREA.lat, lng: DEFAULT_AREA.lng },
      mapZoom: 13,
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
      notifications: [],
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
      setUnits: (units) => {
        setDisplayUnits(units);
        set({ units });
      },
      baseMap: 'satellite',
      setBaseMap: (baseMap) => set({ baseMap }),
      animationsEnabled: true,
      setAnimationsEnabled: (animationsEnabled) => set({ animationsEnabled }),

      // Live analysis
      area: DEFAULT_AREA,
      areaData: null,
      areaStatus: 'idle',
      areaError: null,
      setArea: (area) => {
        set({ area, areaData: null, chatMessages: [] });  // a new place starts a new conversation
        get().loadArea();
      },
      loadArea: async () => {
        inflight?.abort();
        const ctrl = new AbortController();
        inflight = ctrl;
        set({ areaStatus: 'loading', areaError: null });
        try {
          const data = await api.area(get().area, ctrl.signal);
          if (ctrl.signal.aborted) return;
          set({
            areaData: data,
            areaStatus: 'ready',
            notifications: data.notifications.map(n => ({ ...n, timestamp: new Date(n.timestamp) })),
            mapCenter: data.area.coordinates,
            mapZoom: zoomForWidth(data.area.widthKm),
            selectedHotspot: null,
            selectedCandidate: null,
            selectedZone: null,
            chatContext: { ...get().chatContext, selectedLocation: data.area.name },
          });
        } catch (err) {
          if (ctrl.signal.aborted) return;
          set({ areaStatus: 'error', areaError: (err as Error).message });
        }
      },

      // Assistant & reports
      responseStyle: 'scientific',
      setResponseStyle: (responseStyle) => set({ responseStyle }),
      reports: [],
      addReport: (report) => set(s => ({ reports: [report, ...s.reports] })),
    }),
    {
      name: 'climatesmart-prefs',
      partialize: (state) => ({
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
        chatVisible: state.chatVisible,
        mapLayers: state.mapLayers,
        units: state.units,
        baseMap: state.baseMap,
        animationsEnabled: state.animationsEnabled,
        area: state.area,
        responseStyle: state.responseStyle,
        reports: state.reports,
      }),
      // Saved layers keep their on/off and opacity, but always take the current names and descriptions
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<AppState>;
        const layers = DEFAULT_LAYERS.map(l => {
          const old = saved.mapLayers?.find(x => x.id === l.id);
          return old ? { ...l, enabled: old.enabled, opacity: old.opacity } : l;
        });
        return { ...current, ...saved, mapLayers: layers };
      },
      onRehydrateStorage: () => (state) => {
        if (state) setDisplayUnits(state.units);
      },
    }
  )
);
