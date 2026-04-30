import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { taskSyncPlugin } from './vite-plugin-task-sync.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), taskSyncPlugin()],
})
