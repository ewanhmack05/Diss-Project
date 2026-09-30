import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// The backends are proxied through the page's own server (see
// vite.config.ts), so this works from localhost, the LAN or the VPN without
// anything but port 5173 being reachable.
const backend = window.location.origin

// Available slide IDs, from tiler/data/ (each id.mrxs + a same-named
// companion folder):
//   000  CMU-1 (1/16 downsample) - H&E brightfield, 7436x15494
//   001  Mirax2-Fluorescence-1   - 3-channel fluorescence
//   002  Mirax2-Fluorescence-2   - 3-channel fluorescence
//   003  HPS stain, brightfield   - HPS brightfield, 10000x10000
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App
      source={'003'}
      tilerServiceUrl={`${backend}/tiler`}
      annotationStoreUrl={`${backend}/store`}
      realtimeHubUrl={`${backend}/hub`}
      auth={{ authority: `${backend}/auth/realms/diss`, clientId: 'image-viewer' }}
      options={{
        fontSize: '11px',
        tools: [
          'fullscreen',
          'annotations',
          'cellcount',
          'rotate',
          'ruler',
          'adjustments',
          'realtime'
        ]
      }}
      on={(event, payload) => {
        console.log('on');
        console.log('event : ', event);
        console.log('payload : ', payload);
      }}
    />
  </StrictMode>,
)
