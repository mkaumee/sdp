# ClimateSmart AI

A premium climate intelligence platform for urban planners and environmental decision-makers.

## Overview

ClimateSmart AI provides satellite-derived urban heat and vegetation data, AI-powered insights, and interactive tools for identifying heat hotspots and greening opportunities.

> **Demo Mode**: All data in this application is illustrative sample data, not real satellite measurements.

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

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Project Structure

```
src/
├── types/        # TypeScript domain types
├── data/         # Demo/mock data
├── store/        # Zustand state store
├── services/     # API & service layer
├── lib/          # Utility functions
├── components/   # Reusable UI components
│   ├── ui/       # Primitive components
│   └── layout/   # Layout components
└── pages/        # Route-level page components
```

## Data Disclaimer

All temperature, vegetation, and hotspot data shown in this application is **illustrative sample data** created for demonstration purposes. It does not represent real satellite observations, real locations, or real environmental measurements. The Lagos, Nigeria region is used as a geographic reference only.
