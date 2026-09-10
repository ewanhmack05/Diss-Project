import { useDrawContext } from '../../context/DrawContext'
import { ShapeOrder, ShapeTools, LineThicknessOptions, type LineStyleName } from './Tools'
import ColourPicker from './ColourPicker'
import './FreeFormToolPicker.css'

function FreeFormToolPicker() {
  const {
    activeTool,
    setActiveTool,
    colour,
    setColour,
    lineThickness,
    setLineThickness,
    lineStyle,
    setLineStyle,
  } = useDrawContext()

  return (
    <div className="free-form-tool-picker">
      <div className="free-form-tool-picker-shapes">
        {ShapeOrder.map((shape) => (
          <button
            key={shape}
            type="button"
            className={`free-form-tool-picker-shape${activeTool === shape ? ' free-form-tool-picker-shape--active' : ''}`}
            onClick={() => setActiveTool(activeTool === shape ? null : shape)}
          >
            {ShapeTools[shape].label}
          </button>
        ))}
      </div>

      <div className="free-form-tool-picker-row">
        <label className="free-form-tool-picker-field">
          Thickness
          <select
            value={lineThickness}
            onChange={(e) => setLineThickness(Number(e.target.value))}
          >
            {LineThicknessOptions.map((thickness) => (
              <option key={thickness} value={thickness}>
                {thickness}px
              </option>
            ))}
          </select>
        </label>

        <label className="free-form-tool-picker-field">
          Style
          <select
            value={lineStyle}
            onChange={(e) => setLineStyle(e.target.value as LineStyleName)}
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
          </select>
        </label>
      </div>

      <ColourPicker value={colour} onChange={setColour} />

      {activeTool && (
        <p className="free-form-tool-picker-hint">
          Draw on the image to place your {ShapeTools[activeTool].label.toLowerCase()}.
        </p>
      )}
    </div>
  )
}

export default FreeFormToolPicker
