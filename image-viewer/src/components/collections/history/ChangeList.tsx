import { useEffect, useState } from 'react'
import { useAuthContext } from '../../../context/AuthContext'
import { useAnnotationStoreContext } from '../../../context/AnnotationStoreContext'
import Icon from '../../../icons/Icon'
import arrowSvg from '../../../icons/arrow-right.svg?raw'
import { changeLines, deletedLine, type ChangeSetChanges, type Shown } from './changes'

type Loaded = { status: 'loading' } | { status: 'error' } | { status: 'ready'; result: ChangeSetChanges }

function Value({ shown }: { shown: Shown }) {
  return (
    <span className={`history-change-value${shown.empty ? ' history-change-value--empty' : ''}`} title={shown.text}>
      {shown.colour && <span className="history-swatch" style={{ background: shown.colour }} />}
      {shown.text}
    </span>
  )
}

// What one change did - each field it changed, from and to, and what it
// deleted by name. Loaded when the change is opened, not with the list.
function ChangeList({ changeSetId }: { changeSetId: string }) {
  const { authFetch } = useAuthContext()
  const { baseUrl } = useAnnotationStoreContext()
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    authFetch(`${baseUrl}/changesets/${encodeURIComponent(changeSetId)}/changes`)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json() as Promise<ChangeSetChanges>
      })
      .then((result) => {
        if (!cancelled) setLoaded({ status: 'ready', result })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [authFetch, baseUrl, changeSetId])

  if (loaded.status === 'loading') return <p className="collections-note">Loading what changed…</p>
  if (loaded.status === 'error') return <p className="collections-note">Couldn't load what changed.</p>

  const lines = changeLines(loaded.result)
  const deleted = deletedLine(loaded.result)
  if (lines.length === 0 && !deleted) {
    // An add needs nothing more than its label says.
    if (loaded.result.created > 0) return null
    return (
      <p className="collections-note">
        Nothing was recorded for this change - it's from before changes were kept, or it saved what was already there.
      </p>
    )
  }

  // Said once when every line is about the same rows - an edit to one
  // annotation shouldn't name it on every field. Not with a delete, or the
  // rows it names would read as the ones deleted.
  const rows = !deleted && lines.length > 0 && lines.every((line) => line.rows === lines[0].rows) ? lines[0].rows : null

  return (
    <section className="history-changes">
      <h4 className="history-changes-heading">What changed</h4>
      {rows && <p className="history-change-on">{rows}</p>}
      <ul className="history-change-list">
        {deleted && (
          <li className="history-change">
            <div className="history-change-head">
              <span className="history-change-field">Deleted</span>
            </div>
            <div className="history-change-values">{deleted}</div>
          </li>
        )}
        {lines.map((line, i) => (
          <li key={i} className="history-change">
            <div className="history-change-head">
              <span className="history-change-field">{line.field}</span>
              {!rows && <span className="history-change-rows">{line.rows}</span>}
            </div>
            <div className={`history-change-values history-change-values--${line.kind}`}>
              <span className="history-change-froms">
                {line.from.map((from, j) => (
                  <Value key={j} shown={from} />
                ))}
              </span>
              <Icon svg={arrowSvg} size={12} className="history-change-arrow" />
              <Value shown={line.to} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default ChangeList
