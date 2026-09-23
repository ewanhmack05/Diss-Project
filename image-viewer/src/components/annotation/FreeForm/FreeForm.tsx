import { useEffect } from 'react'
import { useDrawContext } from '../../../context/DrawContext'
import { useCellCountDrawContext } from '../../../context/CellCountDrawContext'
import FreeFormToolPicker from './FreeFormToolPicker'
import AddAnnotationForm from './AddAnnotationForm'

// Mirrors FreeFormAnnotation.tsx: swap the tool picker for the save form as
// soon as a shape has been drawn (pending non-null).
function FreeForm() {
  const { pending, setActiveTool } = useDrawContext()
  const { counting } = useCellCountDrawContext()

  // Line is picked when the tab opens, and cleared again when it closes (or
  // switches to Saved), so the map isn't left drawing with no panel showing.
  // Lives here rather than in the tool picker - that remounts every time the
  // save form closes, which kept snapping the tool back to Line.
  useEffect(() => {
    if (!counting) setActiveTool('line')
    return () => setActiveTool(null)
  }, [])

  return pending ? <AddAnnotationForm /> : <FreeFormToolPicker />
}

export default FreeForm
