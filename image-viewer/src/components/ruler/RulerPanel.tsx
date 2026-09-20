import { useRulerContext } from '../../context/RulerContext'
import { formatDistanceMicrons, formatDistancePixels } from './ruler'
import './RulerPanel.css'

function RulerPanel() {
  const { lastMeasurement, clearMeasurement } = useRulerContext()

  const readout = lastMeasurement
    ? lastMeasurement.realDistanceMicrons !== null
      ? formatDistanceMicrons(lastMeasurement.realDistanceMicrons)
      : formatDistancePixels(lastMeasurement.pixelDistance)
    : null

  return (
    <div className="ruler-panel">
      <p className="ruler-panel-hint">Click and drag on the slide to measure a distance.</p>
      <div className="ruler-panel-readout">{readout ?? '-'}</div>
      <button
        type="button"
        className="ruler-panel-clear"
        disabled={!lastMeasurement}
        onClick={clearMeasurement}
      >
        Clear
      </button>
    </div>
  )
}

export default RulerPanel
