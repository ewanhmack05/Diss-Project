import { useCellCountDrawContext } from '../../../context/CellCountDrawContext'
import { useComparisonContext } from '../../../context/ComparisonContext'
import CellCounterToolPicker from './CellCounterToolPicker'
import CellCounterDuring from './CellCounterDuring'
import AddCellCountForm from './AddCellCountForm'
import ComparisonWaiting from '../comparison/ComparisonWaiting'
import ComparisonResults from '../comparison/ComparisonResults'

// Three stages: pick settings and Start (CellCounterToolPicker), the
// counting session itself - ROI placement then the live tally
// (CellCounterDuring) - and, once stopped, naming and saving the result
// (AddCellCountForm, mirrors FreeForm.tsx's own pending swap). A comparison
// count adds waiting on everyone else and the results between the last two.
function CellCounter() {
  const { pending, counting } = useCellCountDrawContext()
  const { stage } = useComparisonContext()

  if (stage === 'results') return <ComparisonResults />
  if (stage === 'waiting') return <ComparisonWaiting />
  if (pending) return <AddCellCountForm />
  if (counting) return <CellCounterDuring />
  return <CellCounterToolPicker />
}

export default CellCounter
