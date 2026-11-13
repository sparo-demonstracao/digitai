import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          panel: resolve(__dirname, 'src/preload/panel.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      minify: true, // menos código para carregar = barrinha mais leve
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          panel: resolve(__dirname, 'src/renderer/panel.html')
        }
      }
    },
    plugins: [react()]
  }
})
