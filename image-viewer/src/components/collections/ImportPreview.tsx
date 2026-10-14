import { useState } from 'react'
import type { Collection } from '../../context/CollectionContext'
import { useEmitEvent } from '../../context/EventContext'
import { ShapeTools, type ShapeTool } from '../annotation/Tools'
import { parseCellCountDots } from '../cell-count/CellCountDots'
import type { ParsedImport } from './collectionGeoJson'
import { useCollectionFiles } from './useCollectionFiles'

interface ImportPreviewProps {
  target: Collection
  fileName: string
  parsed: ParsedImport
  onDone: () => void
}

// Shown once a file's been read, before anything's saved - what's in it,
// what can't be used, and where it's going.
function ImportPreview({ target, fileName, parsed, onDone }: ImportPreviewProps) {
  const { importInto } = useCollectionFiles()
  const emit = useEmitEvent()
  const [saving, setSaving] = useState(false)

  const shapes = new Map<ShapeTool, number>()
  for (const a of parsed.annotations) shapes.set(a.shape, (shapes.get(a.shape) ?? 0) + 1)
  const dots = parsed.cellCounts.reduce((sum, c) => sum + parseCellCountDots(c.dots).length, 0)
  const nothing = parsed.annotations.length === 0 && parsed.cellCounts.length === 0

  const save = () => {
    setSaving(true)
    importInto(target.collectionId, parsed)
      .then(() => {
        emit('collection:imported', { collectionId: target.collectionId })
        onDone()
      })
      .catch(() => {
        emit('collection:import-error', { collectionId: target.collectionId })
        setSaving(false)
      })
  }

  return (
    <div className="collections-panel">
      <section className="collections-section">
        <h3 className="collections-heading">Import GeoJSON</h3>
        <p className="collections-file" title={fileName}>
          {fileName}
        </p>
        <p className="collections-note">
          Into <strong>{target.collectionName}</strong>
        </p>
      </section>

      <section className="collections-section">
        <h3 className="collections-heading">Found</h3>
        <ul className="collections-found">
          <li>
            {parsed.annotations.length} {parsed.annotations.length === 1 ? 'annotation' : 'annotations'}
            {shapes.size > 0 && (
              <span className="collections-found-detail">
                {' '}
                ({[...shapes].map(([shape, n]) => `${n} ${ShapeTools[shape].label.toLowerCase()}`).join(', ')})
              </span>
            )}
          </li>
          <li>
            {parsed.cellCounts.length} {parsed.cellCounts.length === 1 ? 'cell count' : 'cell counts'}
            {parsed.cellCounts.length > 0 && <span className="collections-found-detail"> ({dots} dots)</span>}
          </li>
          {parsed.groups.length > 0 && (
            <li>
              {parsed.groups.length} {parsed.groups.length === 1 ? 'group' : 'groups'}
              <span className="collections-found-detail"> ({parsed.groups.map((g) => g.name).join(', ')})</span>
            </li>
          )}
        </ul>
      </section>

      {parsed.skipped.length > 0 && (
        <section className="collections-section">
          <h3 className="collections-heading">Can't be used ({parsed.skipped.length})</h3>
          <ul className="collections-skipped">
            {parsed.skipped.slice(0, 20).map((s) => (
              <li key={s.index}>
                Feature {s.index + 1}: {s.reason}
              </li>
            ))}
            {parsed.skipped.length > 20 && <li>…and {parsed.skipped.length - 20} more</li>}
          </ul>
        </section>
      )}

      <p className="collections-note">
        {nothing
          ? 'There was nothing in this file that can be added.'
          : 'Everything is added as new, saved by you. Coordinates are read as slide pixels from the top left.'}
      </p>
      <div className="collections-button-row">
        <button type="button" className="collections-button" disabled={saving} onClick={onDone}>
          Cancel
        </button>
        <button
          type="button"
          className="collections-button collections-button--accent"
          disabled={saving || nothing}
          onClick={save}
        >
          {saving ? 'Importing…' : 'Import'}
        </button>
      </div>
    </div>
  )
}

export default ImportPreview
