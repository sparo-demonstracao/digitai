// Pré-visualização do painel no navegador, com dados de exemplo (npx vite --config vite.painel.config.ts).
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  server: { port: 5199, strictPort: true }
})
