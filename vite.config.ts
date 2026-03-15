import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Resolve waterfall-canvas from TypeScript source in dev so the workspace
// package doesn't need a pre-built dist. Published consumers get dist/ via
// the exports map in package.json.
const waterfallSrc = path.resolve(__dirname, '../packages/waterfall-canvas/src')

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'waterfall-canvas/react': path.join(waterfallSrc, 'WaterfallCanvas.tsx'),
      'waterfall-canvas':       path.join(waterfallSrc, 'index.ts'),
    },
  },
})
