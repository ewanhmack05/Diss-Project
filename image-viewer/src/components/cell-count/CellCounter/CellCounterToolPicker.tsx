import { useCellCountDrawContext } from "../../../context/CellCountDrawContext";
import { useCellCountStoreContext } from "../../../context/CellCountStoreContext";
import { useDrawContext } from "../../../context/DrawContext";
import { DotSizeOptions, RoiBoxSizeOptions } from "../Tools";
import { parseCellCountDots, colourBreakdownFromDots } from "../CellCountDots";
import { mostRecentCellCount } from "../CellCountView";
import ColourPicker from "../../colour-picker/ColourPicker";
import CellCountColourSwatch from "../CellCountColourSwatch";
import DockedCard from "../../toolbar/DockedCard";
import "./CellCounterToolPicker.css";

// The pre-count config screen - only rendered while idle (see CellCounter).
// Once Start is pressed, CellCounterDuring takes over for the rest of the
// session, so nothing here needs a `disabled={counting}` guard anymore.
function CellCounterToolPicker() {
  const {
    colour,
    dotSize,
    withAnnotation,
    withRoi,
    boxSizeMicrons,
    setCounting,
    setColour,
    setDotSize,
    setWithAnnotation,
    setWithRoi,
    setBoxSizeMicrons,
    setRoiConfirmed,
    resetCount,
  } = useCellCountDrawContext();
  // Mirrors FreeFormToolPicker's disabling the other way - a map click
  // can't mean both "add a shape vertex" and "tally a cell" at once, so
  // counting can't start while a shape tool is selected.
  const { activeTool } = useDrawContext();
  const { cellCounts } = useCellCountStoreContext();
  const recentCellCount = mostRecentCellCount(cellCounts);

  const handleStart = () => {
    resetCount();
    setRoiConfirmed(false);
    setCounting(true);
  };

  return (
    <div className="cell-counter-tool-picker">
      <DockedCard className="cell-counter-tool-picker-field-card">
        <label className="cell-counter-tool-picker-field">
          Dot size
          <select
            value={dotSize}
            onChange={(e) => setDotSize(Number(e.target.value))}
          >
            {DotSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
        </label>
      </DockedCard>

      <DockedCard
        title="Colour"
        className="cell-counter-tool-picker-colour-card"
      >
        <ColourPicker value={colour} onChange={setColour} />
      </DockedCard>

      <DockedCard
        title="Options"
        className="cell-counter-tool-picker-options-card"
      >
        <label className="cell-counter-tool-picker-field cell-counter-tool-picker-checkbox">
          <input
            type="checkbox"
            checked={withAnnotation}
            onChange={(e) => setWithAnnotation(e.target.checked)}
          />
          With annotation
        </label>
        {/* Box size sits beside the checkbox rather than below it - Options
            stays a constant two visual rows whether ROI is on or off, so
            toggling it never changes this card's height (and doesn't drag
            every other card in the row along with it via
            align-items:stretch), without needing to always mount (and
            disable) the control to hold its place. */}
        <div className="cell-counter-tool-picker-roi-row">
          <label className="cell-counter-tool-picker-field cell-counter-tool-picker-checkbox">
            <input
              type="checkbox"
              checked={withRoi}
              onChange={(e) => setWithRoi(e.target.checked)}
            />
            With region of interest
          </label>
          {withRoi && (
            <select
              className="cell-counter-tool-picker-roi-box-size"
              aria-label="Box size"
              value={boxSizeMicrons}
              onChange={(e) => setBoxSizeMicrons(Number(e.target.value))}
            >
              {RoiBoxSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}µm
                </option>
              ))}
            </select>
          )}
        </div>
      </DockedCard>

      {/* The idle counterpart to CellCounterDuring's spare card - a look
          back at the last saved count rather than anything about the one
          about to start. Same spare-card class so this stays a 4-card row
          matching During's, keeping flex:1 dividing the row identically
          between the two screens (see During's own comment on this). */}
      <DockedCard title="Recent" className="cell-counter-tool-picker-spare-card cell-counter-tool-picker-recent-card">
        {recentCellCount ? (
          <div className="cell-counter-tool-picker-recent">
            <CellCountColourSwatch
              breakdown={colourBreakdownFromDots(parseCellCountDots(recentCellCount.dots))}
              className="cell-counter-tool-picker-recent-swatch"
            />
            <span className="cell-counter-tool-picker-recent-label">
              {recentCellCount.label}
            </span>
            <span className="cell-counter-tool-picker-recent-count">
              {recentCellCount.count}
            </span>
          </div>
        ) : (
          <p className="cell-counter-tool-picker-recent-empty">No counts saved yet</p>
        )}
      </DockedCard>

      <button
        type="button"
        className="cell-counter-tool-picker-button cell-counter-tool-picker-button--primary"
        disabled={activeTool !== null}
        onClick={handleStart}
      >
        Start counting
      </button>

      {activeTool ? (
        <p className="cell-counter-tool-picker-hint">
          Deselect the annotation tool to start counting.
        </p>
      ) : (
        <p className="cell-counter-tool-picker-hint">
          Select start counting to begin cell counter.
        </p>
      )}
    </div>
  );
}

export default CellCounterToolPicker;
