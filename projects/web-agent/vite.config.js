import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { taskSyncPlugin } from './vite-plugin-task-sync.js'

// https://vite.dev/config/
const isElectron = process.env.BUILD_TARGET === 'electron'

export default defineConfig({
  plugins: [react(), taskSyncPlugin()],
  base: isElectron ? './' : '/',
})
