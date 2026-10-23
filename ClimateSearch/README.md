# ClimateSmart AI

A premium climate intelligence platform for urban planners and environmental decision-makers.

## Overview

ClimateSmart AI provides satellite-derived urban heat and vegetation data, AI-powered insights, and interactive tools for identifying heat hotspots and greening opportunities.

All numbers come from the ClimateSmart AI Python server (`app.py` in the folder above), which reads
Landsat 8/9 surface temperature, Sentinel-2 vegetation, ESA WorldCover land cover and Meta population data for
the selected area. Every figure shows the satellite scene it came from.

## Features

- 🗺 **Map Explorer** — Interactive satellite map with temperature and vegetation overlays
- 🔥 **Hotspot Analysis** — Identify and prioritize urban heat hotspots
- 🌿 **Greening Candidates** — Discover and track urban greening opportunities
- 📊 **Reports** — Generate structured climate assessment reports
- 🤖 **AI Assistant** — Context-aware climate intelligence chatbot

## Tech Stack

- **React 18** + **TypeScript**
- **Vite** — Build tool
- **Tailwind CSS** — Styling with CSS custom properties for theming
- **Zustand** — Global state management
- **React Router v6** — Client-side routing
- **Recharts** — Data visualization
- **React Leaflet** — Interactive maps
- **Framer Motion** — Animations
- **Lucide React** — Icons

## Getting Started

Start the Python server first (see the main README), then:

```bash
npm install
npm run dev      # live-reload dev server; /api calls go to the Python server on port 5000
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

For the normal app, run `npm run build` once; the Python server then serves the built app at
[http://127.0.0.1:5000](http://127.0.0.1:5000).

## Project Structure

```
src/
├── types/        # TypeScript domain types
├── store/        # Zustand state store
├── services/     # Calls to the Python server (api.ts) and the chat service
├── lib/          # Utility functions
├── components/   # Reusable UI components
│   ├── ui/       # Primitive components, loading/error gate, data-source badge
│   ├── map/      # Shared map layers (base tiles, measured overlays, label pins)
│   ├── chat/     # The assistant panel
│   └── layout/   # Layout components
└── pages/        # Route-level page components
```

## Data Notes

Temperature, vegetation and hotspot figures are measured from satellite imagery for the selected area. When
Landsat thermal data can't be reached, surface temperature is an **estimate** (NASA POWER air temperature plus
land cover), and the dashboard marks it as such. Hotspots and greening sites are screening results from fixed
rules; ground-truthing is required before investment decisions.
