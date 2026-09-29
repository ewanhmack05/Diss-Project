import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react'
import { useRealtimeContext } from '../../context/RealtimeContext'
import { SharedFields, transformIndex, type FieldChange } from './sharedFields'

type FieldElement = HTMLInputElement | HTMLTextAreaElement

interface FieldProps {
  value: string
  onChange: (event: ChangeEvent<FieldElement>) => void
  ref: (element: FieldElement | null) => void
}

// Text fields shared through the hub under `docId`. Starts from `initial`
// (the saved values) and falls back to plain local editing when realtime
// is off or down. onChange fires for every change, yours or anyone's.
// `fields` must be a constant, or the doc is rebuilt every render.
function useSharedFields<F extends string>(
  docId: string,
  fields: readonly F[],
  initial: Record<F, string>,
  onChange?: (values: Record<F, string>, change: FieldChange<F>) => void
) {
  const { me, openDoc, sendDocUpdate, closeDoc, onDocUpdate, onDocEditors } = useRealtimeContext()
  const [shared, setShared] = useState<SharedFields<F> | null>(null)
  const [values, setValues] = useState(initial)
  const [editors, setEditors] = useState<string[]>([])
  const elementsRef = useRef<Partial<Record<F, FieldElement | null>>>({})
  const selectionsRef = useRef<Partial<Record<F, [number, number]>>>({})
  const initialRef = useRef(initial)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  // Made in an effect, not during render, so a dev-mode double mount
  // doesn't leave a destroyed doc behind.
  useEffect(() => {
    const next = new SharedFields(fields, initialRef.current)
    const unsubscribe = next.subscribe((change) => {
      if (change.remote) {
        const element = elementsRef.current[change.field]
        if (element && element === document.activeElement) {
          const length = next.get(change.field).length
          const move = (index: number) =>
            Math.min(change.delta ? transformIndex(index, change.delta) : index, length)
          selectionsRef.current[change.field] = [
            move(element.selectionStart ?? 0),
            move(element.selectionEnd ?? 0),
          ]
        }
      }
      const current = next.values()
      setValues(current)
      onChangeRef.current?.(current, change)
    })
    setShared(next)
    setValues(next.values())
    return () => {
      unsubscribe()
      next.dispose()
    }
  }, [docId, fields])

  // Setting value from code puts the caret at the end, so put it back where
  // the remote change moved it to.
  useLayoutEffect(() => {
    const pending = selectionsRef.current
    selectionsRef.current = {}
    for (const field of Object.keys(pending) as F[]) {
      const [start, end] = pending[field]!
      elementsRef.current[field]?.setSelectionRange(start, end)
    }
  })

  // (Re)join the shared copy each time we're (re)connected to the hub.
  useEffect(() => {
    if (!shared || !me) return
    const offUpdate = onDocUpdate((id, update) => {
      if (id === docId) shared.receive(update)
    })
    const offEditors = onDocEditors((id, list) => {
      if (id === docId) setEditors(list)
    })
    shared
      .connect({ open: (seed) => openDoc(docId, seed), send: (update) => sendDocUpdate(docId, update) })
      .then((state) => {
        if (state) setEditors(state.editors)
      })
    return () => {
      offUpdate()
      offEditors()
      shared.disconnect()
      closeDoc(docId)
      setEditors([])
    }
  }, [shared, me, docId, openDoc, sendDocUpdate, closeDoc, onDocUpdate, onDocEditors])

  const fieldProps = useCallback(
    (field: F): FieldProps => ({
      value: values[field],
      onChange: (event) => shared?.set(field, event.target.value),
      ref: (element) => {
        elementsRef.current[field] = element
      },
    }),
    [values, shared]
  )

  // Connection ids of everyone with this doc open, you included.
  return { values, editors, fieldProps }
}

export { useSharedFields }
