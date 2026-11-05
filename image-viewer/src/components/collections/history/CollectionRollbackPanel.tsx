import { useState } from 'react'
import { useAuthContext } from '../../../context/AuthContext'
import { useAnnotationStoreContext } from '../../../context/AnnotationStoreContext'
import { useAnnotationGroupContext } from '../../../context/AnnotationGroupContext'
import { useCellCountGroupContext } from '../../../context/CellCountGroupContext'
import { useCellCountStoreContext } from '../../../context/CellCountStoreContext'
import { useRealtimeContext } from '../../../context/RealtimeContext'
import { useToastContext } from '../../../context/ToastContext'
import { rollbackOp } from '../../realtime/realtime'
import type { ChangeSet } from './history'
import { nothingToDo, previewPath, ROLLBACK_NOTE, rollbackLines, rollbackPath, type RollbackView } from './rollback'

type Step = { step: 'idle' } | { step: 'loading' } | { step: 'error' } | { step: 'ready'; view: RollbackView } | { step: 'going'; view: RollbackView }

// On a change opened in the History tab, for editors: asks what putting the
// whole collection back to here would do, and that's the confirm. There can be
// too many rows to send to everyone, so everyone's told once and loads again.
function CollectionRollbackPanel({ changeSet, onDone }: { changeSet: ChangeSet; onDone: () => void }) {
  const { authFetch } = useAuthContext()
  const annotationStore = useAnnotationStoreContext()
  const cellCountStore = useCellCountStoreContext()
  const groups = useAnnotationGroupContext()
  const countGroups = useCellCountGroupContext()
  const { sendOp } = useRealtimeContext()
  const { addToast } = useToastContext()
  const [step, setStep] = useState<Step>({ step: 'idle' })
  const { baseUrl } = annotationStore

  const load = () => {
    setStep({ step: 'loading' })
    authFetch(`${baseUrl}${previewPath(changeSet.id)}`)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json() as Promise<RollbackView>
      })
      .then((view) => setStep({ step: 'ready', view }))
      .catch(() => setStep({ step: 'error' }))
  }

  const go = (view: RollbackView) => {
    setStep({ step: 'going', view })
    authFetch(`${baseUrl}${rollbackPath(changeSet.id, view.latest)}`, { method: 'POST' })
      .then((response) => {
        if (response.status === 409) {
          addToast("It's changed since you looked - here's what it would do now", 'info')
          load()
          return
        }
        if (!response.ok) throw new Error(String(response.status))
        annotationStore.reload()
        cellCountStore.reload()
        groups.reload()
        countGroups.reload()
        sendOp(rollbackOp(changeSet.collectionId))
        addToast('Put the collection back to that point', 'success')
        onDone()
      })
      .catch(() => {
        addToast("Couldn't put the collection back - nothing's changed", 'error')
        setStep({ step: 'ready', view })
      })
  }

  if (step.step === 'idle') {
    return (
      <div className="collections-button-row">
        <button type="button" className="collections-button" onClick={load}>
          Put whole collection back to here…
        </button>
      </div>
    )
  }
  if (step.step === 'loading') return <p className="collections-note">Working out what would change…</p>
  if (step.step === 'error') return <p className="collections-note">Couldn't work out what would change.</p>

  const { view } = step
  if (nothingToDo(view)) return <p className="collections-note">The collection is already how it was then.</p>
  const going = step.step === 'going'

  return (
    <section className="history-changes">
      <h4 className="history-changes-heading">Putting the whole collection back to here</h4>
      <ul className="history-rollback-lines">
        {rollbackLines(view).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="collections-note">{ROLLBACK_NOTE}</p>
      <div className="collections-button-row">
        <button type="button" className="collections-button collections-button--accent" disabled={going} onClick={() => go(view)}>
          {going ? 'Putting back…' : 'Put it all back'}
        </button>
        <button type="button" className="collections-button" disabled={going} onClick={() => setStep({ step: 'idle' })}>
          Cancel
        </button>
      </div>
    </section>
  )
}

export default CollectionRollbackPanel
