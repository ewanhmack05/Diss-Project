import type { ReactNode } from 'react'
import type { Collection } from '../../context/CollectionContext'
import { formatShortDate } from '../saved/savedDates'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// The outline of what's in a collection - for every row in the tab.
function contentsLine(collection: Collection): string {
  const parts = [
    plural(collection.annotationCount, 'annotation', 'annotations'),
    plural(collection.cellCountCount, 'cell count', 'cell counts'),
  ]
  if (collection.lastAdded) parts.push(`last added ${formatShortDate(collection.lastAdded)}`)
  return parts.join(' · ')
}

interface CollectionRowProps {
  collection: Collection
  // Who it's from, or what it is - under the name.
  about: string
  // The one the map is showing.
  here: boolean
  title?: ReactNode
  children?: ReactNode
}

function CollectionRow({ collection, about, here, title, children }: CollectionRowProps) {
  return (
    <li className={`collections-row${here ? ' collections-row--here' : ''}`}>
      <div className="collections-row-top">
        {title ?? <span className="collections-row-name">{collection.collectionName}</span>}
        {here && <span className="collections-badge">Showing</span>}
      </div>
      <span className="collections-row-meta">{about}</span>
      <span className="collections-row-meta">{contentsLine(collection)}</span>
      {children && <div className="collections-row-actions">{children}</div>}
    </li>
  )
}

export default CollectionRow
