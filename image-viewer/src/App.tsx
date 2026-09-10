import { useState } from 'react'
import 'ol/ol.css'
import { DndContext, type DragEndEvent } from '@dnd-kit/core'
import { restrictToWindowEdges } from '@dnd-kit/modifiers'
import { ImageViewerContextProvider } from './context/ImageViewerContext'
import { ToolbarContextProvider, useToolbarContext } from './context/ToolbarContext'
import { AnnotationStoreContextProvider } from './context/AnnotationStoreContext'
import { DrawContextProvider } from './context/DrawContext'
import MapNode from './components/MapNode'
import AnnotationsPanel from './components/annotation/AnnotationsPanel'
import Toolbar, { type ToolName } from './components/toolbar/Toolbar'
import DraggablePanel from './components/toolbar/DraggablePanel'
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
    <ImageViewerContextProvider source={imageSource}>
      <AnnotationStoreContextProvider baseUrl={annotationStoreUrl} onEvent={on}>
        <DrawContextProvider>
          <ToolbarContextProvider>
            <ViewerShell fontSize={options?.fontSize} tools={options?.tools} />
          </ToolbarContextProvider>
        </DrawContextProvider>
      </AnnotationStoreContextProvider>
    </ImageViewerContextProvider>
  )
}

interface ViewerShellProps {
  fontSize?: string
  tools?: ToolName[]
}

function ViewerShell({ fontSize, tools }: ViewerShellProps) {
  const { activeTools, toggleTool } = useToolbarContext()
  const [panelPosition, setPanelPosition] = useState({ x: 24, y: 24 })

  const handleDragEnd = (event: DragEndEvent) => {
    setPanelPosition((pos) => ({
      x: pos.x + event.delta.x,
      y: pos.y + event.delta.y,
    }))
  }

  return (
    <div className="app" style={fontSize ? { fontSize } : undefined}>
      <MapNode />

      <DndContext onDragEnd={handleDragEnd} modifiers={[restrictToWindowEdges]}>
        {activeTools.includes('annotations') && (
          <DraggablePanel
            id="annotations-panel"
            title="Annotations"
            x={panelPosition.x}
            y={panelPosition.y}
            onClose={() => toggleTool('annotations')}
          >
            <AnnotationsPanel />
          </DraggablePanel>
        )}
      </DndContext>

      <Toolbar tools={tools} />
    </div>
  )
}

export default App
