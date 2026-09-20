import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Matches whatever host this page was itself loaded from - 'localhost' when
// opened locally, or this machine's LAN IP when opened from another device
// on the network (see annotation-store/tiler's Program.cs for the CORS side
// of that). Hardcoding 'localhost' here would break the moment this page is
// opened as anything other than http://localhost:5173 itself.
const backendHost = window.location.hostname

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
      tilerServiceUrl={`http://${backendHost}:5095`}
      annotationStoreUrl={`http://${backendHost}:5252`}
      liveServerUrl={`http://${backendHost}:5300`}
      options={{
        fontSize: '11px',
        tools: [
          'fullscreen',
          'annotations',
          'cellcount',
          'rotate',
          'ruler',
          'adjustments',
          'connectome',
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
