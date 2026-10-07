import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig, type ProxyOptions } from 'vite'

// Every backend goes through this server, so other machines (e.g. over the
// VPN) only need to reach port 5173. The services themselves can stay on
// localhost and nothing else needs opening in the firewall.
function to(target: string, prefix: string, ws = false): ProxyOptions {
  return { target, ws, changeOrigin: true, rewrite: (path) => path.slice(prefix.length) }
}

const proxy: Record<string, ProxyOptions> = {
  '/tiler': to('http://localhost:5095', '/tiler'),
  '/store': to('http://localhost:5252', '/store'),
  '/hub': to('http://localhost:5180', '/hub', true),
  // Keycloak (see auth/) - already served under /auth, so no rewrite. The
  // Host and X-Forwarded-* headers go through as the browser sent them, so
  // Keycloak's links and token issuer use the address the viewer was
  // opened on (localhost, LAN or VPN) rather than localhost:8080.
  '/auth': { target: 'http://localhost:8080', changeOrigin: false, xfwd: true },
}

// https://vite.dev/config/
// HTTPS (a self-signed certificate - the browser warns once) because
// sign-in uses the browser's crypto, which only works on https or
// localhost - over plain http the VPN address couldn't sign in at all.
// `npm run dev:http` (mode "http") skips it, for localhost only - no
// certificate warning, and for browsers that won't accept one at all.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'http' ? [react()] : [react(), basicSsl()],
  server: { proxy },
  preview: { proxy },
}))
