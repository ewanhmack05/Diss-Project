import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useAnnotationStoreContext } from './AnnotationStoreContext'

type SelectMode = 'box' | 'lasso'

interface AnnotationSelectContextValue {
  // On while the Select tab is open - MapNode only listens for boxes,
  // lassos and clicks then.
  selecting: boolean
  setSelecting: (selecting: boolean) => void
  mode: SelectMode
  setMode: (mode: SelectMode) => void
  // Only ever annotations that are still there.
  selectedIds: Set<string>
  // add keeps what's already picked - Shift on the map.
  select: (ids: string[], add: boolean) => void
  toggle: (id: string) => void
  clear: () => void
}

const AnnotationSelectContext = createContext<AnnotationSelectContextValue | null>(null)

// What's picked on the Select tab. Your own - not shared with anyone.
function AnnotationSelectContextProvider({ children }: { children: ReactNode }) {
  const { annotations } = useAnnotationStoreContext()
  const [selecting, setSelecting] = useState(false)
  const [mode, setMode] = useState<SelectMode>('box')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  // Deleted ones drop out, whoever deleted them.
  const selectedIds = useMemo(() => {
    const present = new Set(annotations.map((a) => a.id))
    const kept = [...picked].filter((id) => present.has(id))
    return kept.length === picked.size ? picked : new Set(kept)
  }, [annotations, picked])

  const select = useCallback(
    (ids: string[], add: boolean) => setPicked((current) => new Set(add ? [...current, ...ids] : ids)),
    []
  )

  const toggle = useCallback(
    (id: string) =>
      setPicked((current) => {
        const next = new Set(current)
        if (!next.delete(id)) next.add(id)
        return next
      }),
    []
  )

  const clear = useCallback(() => setPicked(new Set()), [])

  return (
    <AnnotationSelectContext.Provider value={{ selecting, setSelecting, mode, setMode, selectedIds, select, toggle, clear }}>
      {children}
    </AnnotationSelectContext.Provider>
  )
}

function useAnnotationSelectContext(): AnnotationSelectContextValue {
  const context = useContext(AnnotationSelectContext)
  if (!context) {
    throw new Error('useAnnotationSelectContext must be used within an AnnotationSelectContextProvider')
  }
  return context
}

export { AnnotationSelectContextProvider, useAnnotationSelectContext }
export type { SelectMode }
