import { createContext, useContext, useState, type ReactNode } from 'react'
import { normalizeDegrees } from '../components/rotation/rotation'

interface RotationContextValue {
  rotationDegrees: number
  setRotationDegrees: (deg: number) => void
  resetRotation: () => void
}

const RotationContext = createContext<RotationContextValue | null>(null)

function RotationContextProvider({ children }: { children: ReactNode }) {
  const [rotationDegrees, setRotationDegreesState] = useState(0)

  const setRotationDegrees = (deg: number) => setRotationDegreesState(normalizeDegrees(deg))
  const resetRotation = () => setRotationDegreesState(0)

  return (
    <RotationContext.Provider value={{ rotationDegrees, setRotationDegrees, resetRotation }}>
      {children}
    </RotationContext.Provider>
  )
}

function useRotationContext(): RotationContextValue {
  const context = useContext(RotationContext)
  if (!context) {
    throw new Error('useRotationContext must be used within a RotationContextProvider')
  }
  return context
}

export { RotationContextProvider, useRotationContext }
