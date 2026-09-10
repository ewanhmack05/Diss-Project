import { useDrawContext } from '../../../context/DrawContext'
import FreeFormToolPicker from './FreeFormToolPicker'
import AddAnnotationForm from './AddAnnotationForm'

// Mirrors FreeFormAnnotation.tsx: swap the tool picker for the save form as
// soon as a shape has been drawn (pending non-null).
function FreeForm() {
  const { pending } = useDrawContext()

  return pending ? <AddAnnotationForm /> : <FreeFormToolPicker />
}

export default FreeForm
