import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // `ws` has optional native accelerators (`bufferutil` and
        // `utf-8-validate`). Bundling it in development makes Vite turn those
        // optional imports into startup errors. Electron can load `ws`
        // directly from node_modules, where the missing accelerators correctly
        // fall back to the package's JavaScript implementation.
        external: ['ws']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs'
        }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()]
  }
})
