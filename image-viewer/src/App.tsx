import { useRef, useState } from 'react'
import 'ol/ol.css'
import { DndContext, type DragEndEvent } from '@dnd-kit/core'
import { restrictToWindowEdges } from '@dnd-kit/modifiers'
import { ImageViewerContextProvider } from './context/ImageViewerContext'
import { ToolbarContextProvider, useToolbarContext } from './context/ToolbarContext'
import { AnnotationStoreContextProvider } from './context/AnnotationStoreContext'
import { DrawContextProvider } from './context/DrawContext'
import { ToastContextProvider } from './context/ToastContext'
import { EventContextProvider } from './context/EventContext'
import MapNode from './components/MapNode'
import AnnotationsPanel from './components/annotation/AnnotationsPanel'
import Toolbar, { type ToolName } from './components/toolbar/Toolbar'
import DraggablePanel from './components/toolbar/DraggablePanel'
import DockZones from './components/toolbar/DockZone'
import { DOCK_SIDES, dockZoneId, type DockSide } from './components/toolbar/dock'
import ToastStack from './components/toast/ToastStack'
import type { ImageSource } from './interfaces/ImageSource'
import './App.css'

interface AppOptions {
  fontSize?: string
  tools?: ToolName[]
}

interface AppProps {
  source: string
  tilerServiceUrl: string
  annotationStoreUrl: string
  options?: AppOptions
  on?: (event: string, payload: unknown) => void
}

function App({ source, tilerServiceUrl, annotationStoreUrl, options, on }: AppProps) {
  const imageSource: ImageSource = { tilerUrl: tilerServiceUrl, slideId: source }

  return (
    <ToastContextProvider>
      <EventContextProvider on={on}>
        <ImageViewerContextProvider source={imageSource}>
          <AnnotationStoreContextProvider baseUrl={annotationStoreUrl}>
            <DrawContextProvider>
              <ToolbarContextProvider>
                <ViewerShell fontSize={options?.fontSize} tools={options?.tools} />
              </ToolbarContextProvider>
            </DrawContextProvider>
          </AnnotationStoreContextProvider>
        </ImageViewerContextProvider>
      </EventContextProvider>
    </ToastContextProvider>
  )
}

interface ViewerShellProps {
  fontSize?: string
  tools?: ToolName[]
}

function ViewerShell({ fontSize, tools }: ViewerShellProps) {
  const { activeTools, toggleTool } = useToolbarContext()
  const [panelPosition, setPanelPosition] = useState({ x: 24, y: 24 })
  const [dockedSide, setDockedSide] = useState<DockSide | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Picking up a docked panel undocks it immediately, shrunk back to its
  // normal floating size right where it was grabbed - not just on drop -
  // so there's no jump once the transform (still zero at this instant)
  // starts tracking the cursor. Measured straight off the DOM rather than
  // dnd-kit's own cached rect for this draggable: that cache isn't
  // refreshed just because our own CSS moved the node (e.g. by docking
  // it), so after a dock it kept reporting the pre-dock floating position -
  // the panel would "start off again" from wherever the very first drag
  // began instead of from the dock it was just pulled out of.
  const handleDragStart = () => {
    if (!dockedSide) return
    const rect = panelRef.current?.getBoundingClientRect()
    if (rect) {
      setPanelPosition({ x: rect.left, y: rect.top })
    }
    setDockedSide(null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const droppedSide = DOCK_SIDES.find((side) => dockZoneId(side) === event.over?.id)
    if (droppedSide) {
      setDockedSide(droppedSide)
      return
    }
    setPanelPosition((pos) => ({
      x: pos.x + event.delta.x,
      y: pos.y + event.delta.y,
    }))
  }

  return (
    <div className="app" style={fontSize ? { fontSize } : undefined}>
      <MapNode />

      <DndContext
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToWindowEdges]}
      >
        <DockZones />
        {activeTools.includes('annotations') && (
          <DraggablePanel
            id="annotations-panel"
            title="Annotations"
            x={panelPosition.x}
            y={panelPosition.y}
            dockedSide={dockedSide}
            panelRef={panelRef}
            onClose={() => toggleTool('annotations')}
          >
            <AnnotationsPanel />
          </DraggablePanel>
        )}
      </DndContext>

      <Toolbar tools={tools} />
      <ToastStack />
    </div>
  )
}

export default App
