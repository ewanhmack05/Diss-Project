import { useDrawContext } from '../../../context/DrawContext'
import { useCellCountDrawContext } from '../../../context/CellCountDrawContext'
import { ShapeOrder, ShapeTools, LineThicknessOptions, type LineStyleName } from '../Tools'
import ColourPicker from '../../colour-picker/ColourPicker'
import DockedCard from '../../toolbar/DockedCard'
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
    quickDraw,
    setQuickDraw,
  } = useDrawContext()
  // A map click can only mean one thing at a time - see MapNode's separate
  // Draw interaction and cell-count click listener, neither aware of the
  // other. Rather than let both fire, shape tools are unavailable while a
  // count is running; CellCounterToolPicker mirrors this the other way.
  const { counting } = useCellCountDrawContext()

  return (
    <div className="free-form-tool-picker">
      <DockedCard title="Shape" className="free-form-tool-picker-shapes-card">
        <div className="free-form-tool-picker-shapes">
          {ShapeOrder.map((shape) => (
            <button
              key={shape}
              type="button"
              className={`free-form-tool-picker-shape${activeTool === shape ? ' free-form-tool-picker-shape--active' : ''}`}
              disabled={counting}
              onClick={() => setActiveTool(activeTool === shape ? null : shape)}
            >
              {ShapeTools[shape].label}
            </button>
          ))}
        </div>
      </DockedCard>

      <DockedCard className="free-form-tool-picker-row">
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
      </DockedCard>

      <DockedCard title="Colour" className="free-form-tool-picker-colour-card">
        <ColourPicker value={colour} onChange={setColour} />
      </DockedCard>

      <DockedCard title="Quick draw" className="free-form-tool-picker-quick-draw-card">
        <label className="free-form-tool-picker-toggle">
          <input
            type="checkbox"
            checked={quickDraw.enabled}
            onChange={(e) => setQuickDraw({ ...quickDraw, enabled: e.target.checked })}
          />
          Save every shape with these details
        </label>
        {quickDraw.enabled && (
          <>
            <label className="free-form-tool-picker-field">
              Label
              <input
                type="text"
                value={quickDraw.label}
                maxLength={64}
                placeholder="Used for every shape"
                onChange={(e) => setQuickDraw({ ...quickDraw, label: e.target.value })}
              />
            </label>
            <label className="free-form-tool-picker-field">
              Notes
              <textarea
                value={quickDraw.notes}
                maxLength={256}
                rows={2}
                placeholder="Optional"
                onChange={(e) => setQuickDraw({ ...quickDraw, notes: e.target.value })}
              />
            </label>
          </>
        )}
      </DockedCard>

      {/* Exactly one hint at a time (counting takes precedence over an
          active tool, which is impossible anyway - see the mutual-exclusion
          comment above) - two of these rendering at once was the extra row
          that threw off every card's apparent size, since flex:1 on
          DockedCard shares the row's width by how many lines/items are
          actually there. */}
      {counting ? (
        <p className="free-form-tool-picker-hint">
          Stop counting to draw an annotation.
        </p>
      ) : quickDraw.enabled && !quickDraw.label.trim() ? (
        <p className="free-form-tool-picker-hint">
          Add a label to use quick draw.
        </p>
      ) : activeTool ? (
        <p className="free-form-tool-picker-hint">
          Draw on the image to place your {ShapeTools[activeTool].label.toLowerCase()}
          {quickDraw.enabled ? ' - each one saves straight away.' : '.'}
        </p>
      ) : (
        <p className="free-form-tool-picker-hint">
          Select a shape to draw an annotation.
        </p>
      )}
    </div>
  )
}

export default FreeFormToolPicker
