import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import type { ImageSource } from './interfaces/ImageSource'

// The viewer works off a single image source, addressed by filepath rather
// than hardcoded into a component. Two kinds are supported:
//   ?src=<url>               a plain static image, e.g. /sample.svg
//   ?slide=<id>&tiler=<url>  a whole-slide image served by tiler/, tiled via
//                            OpenLayers' Zoomify source
// With no params at all, defaults to DEFAULT_SLIDE_ID below - change that
// constant (or pass ?slide=) to switch which sample slide loads. Available
// slide IDs, from tiler/data/ (each id.mrxs + a same-named companion folder):
//   000  CMU-1 (1/16 downsample) - H&E brightfield, 7436x15494
//   001  Mirax2-Fluorescence-1   - 3-channel fluorescence
//   002  Mirax2-Fluorescence-2   - 3-channel fluorescence
const DEFAULT_TILER_URL = 'http://localhost:5095'
const DEFAULT_SLIDE_ID = '000'

const params = new URLSearchParams(window.location.search)
const staticImagePath = params.get('src')

const source: ImageSource = staticImagePath
  ? { kind: 'static', imagePath: staticImagePath }
  : {
    kind: 'tiled',
    tilerUrl: params.get('tiler') ?? DEFAULT_TILER_URL,
    slideId: params.get('slide') ?? DEFAULT_SLIDE_ID,
  }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App source={source} />
  </StrictMode>,
)
