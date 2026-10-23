import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Send API calls to the Python backend (python app.py) while developing with npm run dev
    proxy: { '/api': 'http://127.0.0.1:5000' },
  },
})
