// Core domain types for ClimateSmart AI

export type Severity = 'high' | 'medium' | 'low';
export type Theme = 'light' | 'dark' | 'system';
export type MapLayerId = 'satellite' | 'temperature' | 'vegetation' | 'hotspots' | 'greenspaces' | 'boundaries';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface ClimateZone {
  id: string;
  name: string;
  location: string;
  coordinates: LatLng;
  surfaceTemp: number;  // °C
  vegetationCoverage: number;  // 0-100%
  ndvi: number;  // -1 to 1
  severity: Severity;
  priorityScore: number;  // 0-100
  lastUpdated: string;  // ISO date
  dataSource: string;
}

export interface Hotspot {
  id: string;
  name: string;
  location: string;
  coordinates: LatLng;
  surfaceTemp: number;
  vegetationCoverage: number;
  severity: Severity;
  priorityScore: number;
  lastUpdated: string;
  dataSource: string;
  area?: number;  // km²
  contributing_factors: string[];
  mitigation_suggestions: string[];
  imageDate: string;
}

export interface GreeningCandidate {
  id: string;
  name: string;
  location: string;
  coordinates: LatLng;
  currentVegetation: number;  // 0-100%
  surfaceTemp: number;
  priorityScore: number;
  severity: Severity;
  candidateArea: number;  // hectares
  reasoning: string;
  recommendedAction: string;
  status: 'identified' | 'under-review' | 'approved' | 'in-progress' | 'completed';
  nearestHotspotId?: string;
  dataSource: string;
  lastUpdated: string;
}

export interface ClimateMetric {
  id: string;
  label: string;
  value: number | string;
  unit: string;
  trend?: 'up' | 'down' | 'stable';
  trendValue?: number;
  trendPeriod?: string;
  severity?: Severity;
  description: string;
  dataSource: string;
  isDemo: boolean;
}

export interface MapLayer {
  id: MapLayerId;
  label: string;
  description: string;
  enabled: boolean;
  opacity: number;
  color?: string;
}

export type ChatMessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  timestamp: Date;
  isLoading?: boolean;
  hasError?: boolean;
  context?: ChatContext;
  media?: {
    url?: string;
    caption?: string;
    metadata?: string;
  };
}

export interface ChatContext {
  route?: string;
  selectedLocation?: string;
  selectedCoordinates?: LatLng;
  selectedHotspot?: string;
  selectedCandidate?: string;
  activeFilters?: Record<string, unknown>;
  activeLayers?: MapLayerId[];
  relevantMetrics?: ClimateMetric[];
}

export interface Report {
  id: string;
  title: string;
  type: ReportType;
  status: 'draft' | 'generating' | 'ready' | 'failed';
  createdAt: string;
  generatedAt?: string;
  location?: string;
  dateRange?: { start: string; end: string };
  metrics?: string[];
  description: string;
  dataSource: string;
}

export type ReportType =
  | 'urban-heat'
  | 'vegetation-coverage'
  | 'hotspot-prioritization'
  | 'greening-opportunity'
  | 'zone-comparison'
  | 'climate-overview';

export interface UserPreferences {
  theme: Theme;
  sidebarCollapsed: boolean;
  chatPanelVisible: boolean;
  defaultMapLayer: MapLayerId;
  defaultLocation: LatLng;
  units: 'metric' | 'imperial';
  animationsEnabled: boolean;
  assistantPanelPosition: 'right' | 'bottom';
}

export interface SearchResult {
  id: string;
  label: string;
  sublabel?: string;
  type: 'location' | 'hotspot' | 'greening' | 'report';
  coordinates?: LatLng;
  route?: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'error';
  timestamp: Date;
  read: boolean;
  route?: string;
}
