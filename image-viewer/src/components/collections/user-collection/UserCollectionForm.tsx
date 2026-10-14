import { useState } from 'react'
import type { Collection } from '../../../context/CollectionContext'

interface UserCollectionFormProps {
  collection: Collection
  onRename: (name: string) => Promise<void>
}

// The name of your own collection, and the pencil to rename it.
function UserCollectionForm({ collection, onRename }: UserCollectionFormProps) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(collection.collectionName)

  const save = () => {
    setEditing(false)
    const trimmed = name.trim()
    if (trimmed && trimmed !== collection.collectionName) onRename(trimmed).catch(() => setName(collection.collectionName))
  }

  if (editing) {
    return (
      <input
        className="collections-name-input"
        aria-label="Collection name"
        value={name}
        maxLength={64}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
    )
  }

  return (
    <span className="collections-name-row">
      <span className="collections-row-name">{collection.collectionName}</span>
      <button
        type="button"
        className="collections-icon-button"
        aria-label="Rename your collection"
        onClick={() => {
          setName(collection.collectionName)
          setEditing(true)
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M11 2.5 L13.5 5 L5.5 13 L2.5 13.5 L3 10.5 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      </button>
    </span>
  )
}

export default UserCollectionForm
