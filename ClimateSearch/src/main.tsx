import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import App from './App.tsx'
import './index.css'

// Fix default leaflet icon paths for bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Initialize theme on load
const initTheme = () => {
  const stored = localStorage.getItem('climatesmart-prefs');
  let theme = 'dark';
  if (stored) {
    try {
      theme = JSON.parse(stored)?.state?.theme ?? 'dark';
    } catch { /* ignore */ }
  }
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
};

initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
