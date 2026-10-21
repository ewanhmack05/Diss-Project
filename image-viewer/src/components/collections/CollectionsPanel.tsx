import { useEffect, useRef, useState } from 'react'
import { useCollectionContext, type Collection } from '../../context/CollectionContext'
import { useAnnotationStoreContext } from '../../context/AnnotationStoreContext'
import { useCellCountStoreContext } from '../../context/CellCountStoreContext'
import { useEmitEvent } from '../../context/EventContext'
import { useToastContext } from '../../context/ToastContext'
import { usePresenceContext } from '../../context/PresenceContext'
import { parseImport, type ParsedImport } from './collectionGeoJson'
import { useCollectionFiles } from './useCollectionFiles'
import ImportPreview from './ImportPreview'
import UserCollection from './user-collection/UserCollection'
import SharedCollectionList from './shared-collection/SharedCollectionList'
import HistoryList from './history/HistoryList'
import './CollectionsPanel.css'

type CollectionsTab = 'mine' | 'shared' | 'history'

interface PendingImport {
  target: Collection
  fileName: string
  parsed: ParsedImport
}

// Where you're looking, when it isn't your own.
function ShowingNote({ active }: { active: Collection }) {
  const { leaveSession, dormant, reopen } = useCollectionContext()
  const { busySessions } = usePresenceContext()
  const readOnly = active.myRole === 'viewer' || !!active.ended || dormant
  // Someone's gone back in since you opened it to look.
  const someoneIn = dormant && busySessions?.has(active.collectionId)
  return (
    <div className="collections-showing">
      <p className="collections-note">
        Showing <strong>{active.collectionName}</strong>
        {dormant ? (someoneIn ? " - someone's in it now." : " - nobody's in it, so it's read-only.") : readOnly ? ' - read-only.' : '.'}
      </p>
      {dormant && (someoneIn || active.myRole === 'owner') && (
        <button type="button" className="collections-button collections-button--accent" onClick={reopen}>
          {someoneIn ? 'Rejoin' : 'Reopen'}
        </button>
      )}
      <button type="button" className="collections-button" onClick={leaveSession}>
        Back to mine
      </button>
    </div>
  )
}

// Mine: your own collection on this slide. Shared: the sessions you're in,
// and anyone else's they've shared - how much is in each, and moving between them.
// History: every change made in the one you're in, and putting back what
// a change deleted.
// Any of them can be exported as GeoJSON, and a file imported into any you
// can edit.
function CollectionsPanel() {
  const { status, collections, personalCollectionId, active, refresh } = useCollectionContext()
  const { revision: annotationRevision } = useAnnotationStoreContext()
  const { revision: cellCountRevision } = useCellCountStoreContext()
  const { exportCollection } = useCollectionFiles()
  const emit = useEmitEvent()
  const { addToast } = useToastContext()
  const [pending, setPending] = useState<PendingImport | null>(null)
  // Kept here rather than in the toolbar's context, like RealTime's - it's
  // your own, so Present doesn't follow the host's.
  const [tab, setTab] = useState<CollectionsTab>('mine')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importTargetRef = useRef<Collection | null>(null)

  // Counts are kept up to date while it's open - as things are added or
  // deleted, and for anyone who's started sharing since.
  useEffect(() => {
    refresh()
  }, [refresh, annotationRevision, cellCountRevision])

  const startExport = (collection: Collection) =>
    exportCollection(collection.collectionId)
      .then(() => emit('collection:exported', { collectionId: collection.collectionId }))
      .catch(() => emit('collection:export-error', { collectionId: collection.collectionId }))

  const startImport = (collection: Collection) => {
    importTargetRef.current = collection
    fileInputRef.current?.click()
  }

  const readFile = async (file: File) => {
    const target = importTargetRef.current
    if (!target) return
    try {
      setPending({ target, fileName: file.name, parsed: parseImport(await file.text()) })
    } catch (error) {
      addToast(error instanceof Error ? error.message : "Couldn't read that file", 'error')
    }
  }

  if (pending) return <ImportPreview {...pending} onDone={() => setPending(null)} />

  const mine = collections.find((c) => c.collectionId === personalCollectionId)
  const sessions = collections.filter((c) => c.kind === 'session')
  const others = collections.filter((c) => c.kind === 'personal' && c.collectionId !== personalCollectionId)
  const activeId = active?.collectionId ?? null

  let body
  if (status !== 'ready') {
    body = <p className="collections-note">{status === 'error' ? "Couldn't load collections." : 'Loading…'}</p>
  } else if (tab === 'mine') {
    body = (
      <section className="collections-section">
        {mine && (
          <UserCollection
            collection={mine}
            here={activeId === mine.collectionId}
            onExport={() => startExport(mine)}
            onImport={() => startImport(mine)}
          />
        )}
      </section>
    )
  } else if (tab === 'history') {
    // Keyed so moving collection starts back on the first page.
    body = active ? <HistoryList key={active.collectionId} collection={active} /> : null
  } else {
    body = (
      <>
        <section className="collections-section">
          <h3 className="collections-heading">Sessions ({sessions.length})</h3>
          {sessions.length > 0 ? (
            <SharedCollectionList collections={sessions} activeId={activeId} onExport={startExport} onImport={startImport} />
          ) : (
            <p className="collections-note">Sessions you start or join from RealTime show up here.</p>
          )}
        </section>

        <section className="collections-section">
          <h3 className="collections-heading">Shared with everyone ({others.length})</h3>
          {others.length > 0 ? (
            <SharedCollectionList collections={others} activeId={activeId} onExport={startExport} onImport={startImport} />
          ) : (
            <p className="collections-note">Nobody else has shared their collection on this slide yet.</p>
          )}
        </section>
      </>
    )
  }

  return (
    <div className="collections-panel-wrap">
      <input
        ref={fileInputRef}
        type="file"
        accept=".geojson,.json,application/geo+json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Cleared so picking the same file again still fires.
          e.target.value = ''
          if (file) readFile(file)
        }}
      />
      <div className="collections-tabs" role="tablist" aria-label="Collections">
        {(['mine', 'shared', 'history'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={tab === option}
            className={`collections-tab${tab === option ? ' collections-tab--active' : ''}`}
            onClick={() => setTab(option)}
          >
            {option === 'mine' ? 'Mine' : option === 'shared' ? `Shared (${sessions.length + others.length})` : 'History'}
          </button>
        ))}
      </div>
      <div className="collections-panel" role="tabpanel">
        {status === 'ready' && active && active.collectionId !== personalCollectionId && <ShowingNote active={active} />}
        {body}
      </div>
    </div>
  )
}

export default CollectionsPanel
