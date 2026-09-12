import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Available slide IDs, from tiler/data/ (each id.mrxs + a same-named
// companion folder):
//   000  CMU-1 (1/16 downsample) - H&E brightfield, 7436x15494
//   001  Mirax2-Fluorescence-1   - 3-channel fluorescence
//   002  Mirax2-Fluorescence-2   - 3-channel fluorescence
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App
      source={'000'}
      tilerServiceUrl={'http://localhost:5095'}
      annotationStoreUrl={'http://localhost:5252'}
      options={{
        fontSize: '11px',
        tools: [
          'fullscreen',
          'annotations',
          'cellcount',
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
