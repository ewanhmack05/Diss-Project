import { useCallback } from 'react'
import { useAuthContext } from '../../context/AuthContext'
import { useAnnotationStoreContext } from '../../context/AnnotationStoreContext'
import { useCellCountStoreContext } from '../../context/CellCountStoreContext'
import { useCellCountGroupContext } from '../../context/CellCountGroupContext'
import { useAnnotationGroupContext } from '../../context/AnnotationGroupContext'
import type { AnnotationGroup } from '../../interfaces/AnnotationGroup'
import { useCollectionContext } from '../../context/CollectionContext'
import type { Annotation } from '../../interfaces/Annotation'
import type { CellCount } from '../../interfaces/CellCount'
import type { CellCountGroup } from '../../interfaces/CellCountGroup'
import type { ImportSource } from '../messages/messages'
import { collectionToGeoJson, exportFileName, type FullCollection, type ParsedImport } from './collectionGeoJson'

function download(fileName: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/geo+json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  // Left a moment so the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Exporting any collection you can see as GeoJSON, and importing a file into
// one you can edit. Both reject if annotation-store says no.
function useCollectionFiles() {
  const { authFetch } = useAuthContext()
  const { baseUrl, addImported: showAnnotations } = useAnnotationStoreContext()
  const { addImported: showCellCounts } = useCellCountStoreContext()
  const { addImported: showGroups } = useAnnotationGroupContext()
  const { addImported: showCountGroups } = useCellCountGroupContext()
  const { collectionId: activeId, refresh } = useCollectionContext()

  const exportCollection = useCallback(
    async (collectionId: string) => {
      const response = await authFetch(`${baseUrl}/collections/${collectionId}/export`)
      if (!response.ok) throw new Error(String(response.status))
      const full = (await response.json()) as FullCollection
      download(exportFileName(full), JSON.stringify(collectionToGeoJson(full)))
    },
    [authFetch, baseUrl]
  )

  // Into the one you're in, it shows straight away, and goes to everyone
  // else in a session. Anywhere else, it's there next time it's opened. source
  // says it was sent in a message, rather than read from a file.
  const importInto = useCallback(
    async (collectionId: string, parsed: ParsedImport & { source?: ImportSource }) => {
      const response = await authFetch(`${baseUrl}/collections/${collectionId}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: parsed.annotations, cellCounts: parsed.cellCounts, groups: parsed.groups, cellCountGroups: parsed.cellCountGroups, source: parsed.source }),
      })
      if (!response.ok) throw new Error(String(response.status))
      const saved = (await response.json()) as { annotations: Annotation[]; cellCounts: CellCount[]; groups: AnnotationGroup[]; cellCountGroups?: CellCountGroup[] }
      if (collectionId === activeId) {
        // Groups first, so nobody gets annotations in a group they don't know.
        showGroups(saved.groups)
        showCountGroups(saved.cellCountGroups ?? [])
        showAnnotations(saved.annotations)
        showCellCounts(saved.cellCounts)
      }
      await refresh()
    },
    [authFetch, baseUrl, activeId, showGroups, showCountGroups, showAnnotations, showCellCounts, refresh]
  )

  return { exportCollection, importInto }
}

export { useCollectionFiles }
