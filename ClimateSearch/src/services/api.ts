// Talks to the ClimateSmart AI backend (app.py). In development Vite forwards /api to Flask on port 5000.
import type { AreaData, AreaSelection, AssistantStyle, ChatContext, Report, ReportType } from '@/types';

/** A place found by the place search. */
export interface PlaceResult {
  name: string;
  detail: string;
  lat: number;
  lon: number;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

function areaParams(area: AreaSelection) {
  return { lat: area.lat, lon: area.lng, width: area.widthKm, name: area.name, location: area.location };
}

export const api = {
  /** Full heat & greening analysis of an area (takes ~5-20 s the first time, then it's cached). */
  area(area: AreaSelection, signal?: AbortSignal) {
    const params = new URLSearchParams();
    Object.entries(areaParams(area)).forEach(([k, v]) => v !== undefined && v !== '' && params.set(k, String(v)));
    return request<AreaData>(`/api/area?${params}`, { signal });
  },

  /** Places matching a name (OpenStreetMap). */
  async searchPlaces(query: string) {
    const body = await request<{ places: PlaceResult[] }>(`/api/search?q=${encodeURIComponent(query)}`);
    return body.places;
  },

  /** Generate a report from the live analysis (a date range re-runs it on imagery from those dates). */
  createReport(area: AreaSelection, options: {
    template: ReportType; zones: string[]; metrics: string[]; dateRange?: { start: string; end: string }; reportLocation: string;
  }) {
    return request<Report>('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...areaParams(area), ...options }),
    });
  },

  /** Ask the assistant; it may attach a satellite photo. */
  ask(area: AreaSelection, messages: { role: string; content: string }[], context: ChatContext, style: AssistantStyle) {
    return request<{ reply: string; media: { url: string; caption: string; metadata: string } | null; model: string }>(
      '/api/assistant',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...areaParams(area), messages, context, style }),
      },
    );
  },
};
