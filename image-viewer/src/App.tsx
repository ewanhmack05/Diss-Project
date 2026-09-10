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
import Toolbar from './components/toolbar/Toolbar'
import DraggablePanel from './components/toolbar/DraggablePanel'
import type { ImageSource } from './interfaces/ImageSource'
import './App.css'

interface AppProps {
  source: ImageSource
}

function App({ source }: AppProps) {
  return (
    <ImageViewerContextProvider source={source}>
      <AnnotationStoreContextProvider>
        <DrawContextProvider>
          <ToolbarContextProvider>
            <ViewerShell />
          </ToolbarContextProvider>
        </DrawContextProvider>
      </AnnotationStoreContextProvider>
    </ImageViewerContextProvider>
  )
}

function ViewerShell() {
  const { activeTools, toggleTool } = useToolbarContext()
  const [panelPosition, setPanelPosition] = useState({ x: 24, y: 24 })

  const handleDragEnd = (event: DragEndEvent) => {
    setPanelPosition((pos) => ({
      x: pos.x + event.delta.x,
      y: pos.y + event.delta.y,
    }))
  }

  return (
    <div className="app">
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

      <Toolbar />
    </div>
  )
}

export default App
