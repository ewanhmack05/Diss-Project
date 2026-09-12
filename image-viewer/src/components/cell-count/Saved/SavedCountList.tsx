import { useCellCountStoreContext } from "../../../context/CellCountStoreContext";
import { parseCellCountDots, colourBreakdownFromDots } from "../CellCountDots";
import { toggleViewedCellCountId } from "../CellCountView";
import CellCountColourSwatch from "../CellCountColourSwatch";
import SavedCountEdit from "./SavedCountEdit";
import "./SavedCountList.css";

function SavedCountList() {
  const {
    cellCounts,
    status,
    selectedCellCountId,
    viewedCellCountId,
    setSelectedCellCountId,
    setViewedCellCountId,
  } = useCellCountStoreContext();

  const editing = cellCounts.find((c) => c.id === selectedCellCountId);
  if (editing) {
    return (
      <SavedCountEdit
        cellCount={editing}
        onBack={() => setSelectedCellCountId(null)}
      />
    );
  }

  if (status === "loading") {
    return <p className="saved-cell-count-list-empty">Loading...</p>;
  }

  if (status === "error") {
    return (
      <p className="saved-cell-count-list-empty">
        Couldn't reach the annotation store.
      </p>
    );
  }

  if (cellCounts.length === 0) {
    return <p className="saved-cell-count-list-empty">Nothing saved yet.</p>;
  }

  return (
    <ul className="saved-cell-count-list themed-scroll">
      {cellCounts.map((cellCount) => {
        const isViewing = viewedCellCountId === cellCount.id;
        return (
          <li key={cellCount.id} className="saved-cell-count-list-row">
            <button
              type="button"
              className="saved-cell-count-list-item"
              onClick={() => setSelectedCellCountId(cellCount.id)}
            >
              <CellCountColourSwatch
                breakdown={colourBreakdownFromDots(
                  parseCellCountDots(cellCount.dots),
                )}
                className={`saved-cell-count-list-swatch${cellCount.withAnnotation ? "" : " saved-cell-count-list-swatch--hidden"}`}
              />
              <span className="saved-cell-count-list-label">
                {cellCount.label}
              </span>
              <span className="saved-cell-count-list-count">
                {cellCount.count}
              </span>
            </button>
            <button
              type="button"
              className={`saved-cell-count-list-view${isViewing ? " saved-cell-count-list-view--active" : ""}${cellCount.withAnnotation ? "" : " saved-cell-count-list-view--hidden"}`}
              disabled={
                !cellCount.withAnnotation ||
                cellCount.locationX === null ||
                cellCount.locationY === null
              }
              tabIndex={cellCount.withAnnotation ? 0 : -1}
              title={
                cellCount.locationX === null
                  ? "No location recorded for this count"
                  : isViewing
                    ? "Hide this count"
                    : "Show this count on the map"
              }
              onClick={() =>
                setViewedCellCountId(
                  toggleViewedCellCountId(viewedCellCountId, cellCount.id),
                )
              }
            >
              {isViewing ? "Hide" : "View"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default SavedCountList;
