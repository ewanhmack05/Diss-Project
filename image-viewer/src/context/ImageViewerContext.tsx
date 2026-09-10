import { createContext, useContext, type ReactNode } from 'react'
import type { ImageSource } from '../interfaces/ImageSource'

interface ImageViewerContextValue {
  source: ImageSource
}

const ImageViewerContext = createContext<ImageViewerContextValue | null>(null)

interface ImageViewerContextProviderProps {
  source: ImageSource
  children: ReactNode
}

function ImageViewerContextProvider({ source, children }: ImageViewerContextProviderProps) {
  return <ImageViewerContext.Provider value={{ source }}>{children}</ImageViewerContext.Provider>
}

function useImageViewerContext(): ImageViewerContextValue {
  const context = useContext(ImageViewerContext)
  if (!context) {
    throw new Error('useImageViewerContext must be used within an ImageViewerContextProvider')
  }
  return context
}

export { ImageViewerContextProvider, useImageViewerContext }
