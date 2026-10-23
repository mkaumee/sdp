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
  bounds?: [[number, number], [number, number]];  // [[south, west], [north, east]]
  builtPct?: number;
  treePct?: number;
  people?: number | null;
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
  bounds?: [[number, number], [number, number]];
  cells?: { row: number; col: number; bounds: [[number, number], [number, number]] }[];
  people?: number | null;
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
  nearestHotspotId?: string | null;
  dataSource: string;
  lastUpdated: string;
  interventionType?: string;
  bounds?: [[number, number], [number, number]];
}

export interface ClimateMetric {
  id: string;
  label: string;
  value: number | string;
  unit: string;
  trend?: 'up' | 'down' | 'stable';
  trendValue?: number;
  trendPeriod?: string;
  severity?: Severity | null;
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
  content?: ReportContent;  // filled in by the backend when the report is generated
}

export interface ReportContent {
  summary: string;
  zones: { name: string; surfaceTemp: number | null; vegetationCoverage: number; severity: Severity; priorityScore: number }[];
  metrics: { label: string; value: string; note: string | null }[];
  methodology: string[];
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

// ---------- Live analysis from the ClimateSmart AI backend (/api/area) ----------

/** The place the dashboard is analysing. */
export interface AreaSelection {
  lat: number;
  lng: number;
  widthKm: number;
  name?: string;  // short name, e.g. "Shah Alam" (the backend looks it up when missing)
  location?: string;  // full name, e.g. "Shah Alam, Selangor, Malaysia"
}

export interface AreaInfo {
  name: string;
  location: string;
  coordinates: LatLng;
  widthKm: number;
  cellKm: number;
  bounds: BoundingBox;
}

/** Where a layer's numbers came from. */
export interface SourceInfo {
  kind: string;  // "landsat" | "estimate" | "none" | "sentinel2" | "worldcover"
  label: string;  // short, e.g. "Landsat 9 thermal · 14 Aug 2026"
  sensor: string;  // longer description
  dates: string[];
  note?: string | null;
  isEstimate: boolean;
}

export interface Provenance {
  surfaceTemp: SourceInfo;
  vegetation: SourceInfo;
  landcover: string;
  population: string;
  climate: string | null;
  updated: string;  // newest imagery date
  sensorsLabel: string;  // e.g. "Sentinel-2 & Landsat 9"
}

export interface MapOverlay {
  url: string;  // PNG data URL
  bounds: [[number, number], [number, number]];
  min: number;
  max: number;
  unit: string;
  label: string;
}

/** One cell of the analysis grid (for clicking anywhere on the map). */
export interface AreaCell {
  row: number;
  col: number;
  bounds: [[number, number], [number, number]];
  center: LatLng;
  surfaceTemp: number | null;
  vegetationCoverage: number;
  ndvi: number | null;
  builtPct: number;
  barePct: number;
  treePct: number;
  waterPct: number;
  openPct: number;
  people: number | null;
  priorityScore: number;
  severity: Severity;
  mainCover: string;
}

export interface AreaData {
  area: AreaInfo;
  generatedAt: string;
  metrics: ClimateMetric[];
  zones: ClimateZone[];
  hotspots: Hotspot[];
  greeningCandidates: GreeningCandidate[];
  cells: AreaCell[];
  correlation: number | null;
  thresholds: { hotspot: number | null; critical: number | null; tempMin: number | null; tempMax: number | null };
  overlays: { temperature?: MapOverlay; vegetation?: MapOverlay };
  notifications: (Omit<Notification, 'timestamp'> & { timestamp: string })[];
  provenance: Provenance;
  warnings: string[];
}

export type AssistantStyle = 'concise' | 'scientific' | 'strategic';
