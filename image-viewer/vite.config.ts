import react from '@vitejs/plugin-react'
import { defineConfig, type ProxyOptions } from 'vite'

// Every backend goes through this server, so other machines (e.g. over the
// VPN) only need to reach port 5173. The services themselves can stay on
// localhost and nothing else needs opening in the firewall.
function to(target: string, prefix: string, ws = false): ProxyOptions {
  return { target, ws, changeOrigin: true, rewrite: (path) => path.slice(prefix.length) }
}

const proxy = {
  '/tiler': to('http://localhost:5095', '/tiler'),
  '/store': to('http://localhost:5252', '/store'),
  '/hub': to('http://localhost:5180', '/hub', true),
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
})
