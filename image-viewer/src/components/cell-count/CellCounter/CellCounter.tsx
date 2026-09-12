import { useCellCountDrawContext } from '../../../context/CellCountDrawContext'
import CellCounterToolPicker from './CellCounterToolPicker'
import CellCounterDuring from './CellCounterDuring'
import AddCellCountForm from './AddCellCountForm'

// Three stages: pick settings and Start (CellCounterToolPicker), the
// counting session itself - ROI placement then the live tally
// (CellCounterDuring) - and, once stopped, naming and saving the result
// (AddCellCountForm, mirrors FreeForm.tsx's own pending swap).
function CellCounter() {
  const { pending, counting } = useCellCountDrawContext()

  if (pending) return <AddCellCountForm />
  if (counting) return <CellCounterDuring />
  return <CellCounterToolPicker />
}

export default CellCounter
