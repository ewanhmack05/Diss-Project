import { useState, type ReactNode } from "react";
import { useCellCountStoreContext } from "../../../context/CellCountStoreContext";
import type { CellCount } from "../../../interfaces/CellCount";
import {
  parseCellCountDots,
  colourBreakdownFromDots,
  placedByBreakdown,
} from "../CellCountDots";
import { toggleViewedCellCountId } from "../CellCountView";
import CellCountColourSwatch from "../CellCountColourSwatch";
import SavedCountEdit from "./SavedCountEdit";
import SavedRow, { SavedDetails } from "../../saved/SavedRow";
import { formatLongDate, formatShortDate, newestFirst } from "../../saved/savedDates";
import { savedBy } from "../../saved/savedBy";
import { useAuthContext } from "../../../context/AuthContext";
import { useCollectionContext } from "../../../context/CollectionContext";
import "./SavedCountList.css";

function RoiIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="none" stroke="#00e0ff" strokeWidth="1.3" strokeDasharray="2 1.5" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg width="13" height="11" viewBox="0 0 14 12" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.2">
        <circle cx="5" cy="3.5" r="2.2" />
        <path d="M1 11 C1 8, 9 8, 9 11" />
        <circle cx="10" cy="4" r="1.8" />
        <path d="M10 7.8 C12 7.8, 13 9, 13 11" />
      </g>
    </svg>
  );
}

interface SavedCountRowProps {
  cellCount: CellCount;
  open: boolean;
  onToggle: () => void;
}

function SavedCountRow({ cellCount, open, onToggle }: SavedCountRowProps) {
  const { viewedCellCountId, setSelectedCellCountId, setViewedCellCountId } =
    useCellCountStoreContext();
  const { canEdit } = useCollectionContext();
  const { user } = useAuthContext();
  const by = savedBy(cellCount, user.id);
  const dots = parseCellCountDots(cellCount.dots);
  const colours = colourBreakdownFromDots(dots);
  const people = placedByBreakdown(dots);
  const isViewing = viewedCellCountId === cellCount.id;
  // Same rules as the old View button - nothing to draw without dots or
  // a location.
  const canView =
    cellCount.withAnnotation &&
    cellCount.locationX !== null &&
    cellCount.locationY !== null;

  const colourChips =
    colours.length > 0 ? (
      colours.map(({ colour, count }) => (
        <span key={colour} className="saved-row-tag">
          <span className="saved-row-dot" style={{ background: colour }} />
          {count}
        </span>
      ))
    ) : (
      <span>Tally only</span>
    );

  const details: [string, ReactNode][] = [
    ["Colours", colours.length > 0 ? <span key="colours" className="saved-row-chips">{colourChips}</span> : "Tally only, no dots"],
    ["Region", cellCount.withRoi ? "Region of interest box" : "None"],
  ];
  if (people.length > 0) {
    details.push([
      "Counted by",
      <span key="people" className="saved-row-people">
        {people.map((person) => (
          <span key={person.userId} className="saved-row-person" title={person.userId}>
            <span>{person.name}</span>
            <span>{person.count}</span>
          </span>
        ))}
      </span>,
    ]);
  }
  if (cellCount.notes) details.push(["Notes", cellCount.notes]);
  if (by) details.push(["Saved by", by]);
  details.push(["Saved", formatLongDate(cellCount.created)]);

  return (
    <SavedRow
      open={open}
      onToggle={onToggle}
      leading={
        <CellCountColourSwatch breakdown={colours} className="saved-cell-count-list-swatch" />
      }
      label={cellCount.label}
      trailing={<span className="saved-cell-count-list-count">{cellCount.count}</span>}
      meta={
        <>
          {colourChips}
          {cellCount.withRoi && (
            <span className="saved-row-tag saved-row-tag--roi">
              <RoiIcon />
              ROI
            </span>
          )}
          {people.length > 0 && (
            <span className="saved-row-tag" title={people.map((p) => p.name).join(", ")}>
              <PeopleIcon />
              {people.length}
            </span>
          )}
          {isViewing && <span className="saved-row-tag saved-row-tag--active">On map</span>}
          <span className="saved-row-spacer" />
          {by && <span className="saved-row-by">{by}</span>}
          <span>{formatShortDate(cellCount.created)}</span>
        </>
      }
      notes={cellCount.notes}
    >
      <SavedDetails
        items={details}
        actions={
          <>
            <button
              type="button"
              className="saved-row-button"
              disabled={!canView}
              title={canView ? undefined : "Nothing to show - no dots or location were recorded"}
              onClick={() =>
                setViewedCellCountId(toggleViewedCellCountId(viewedCellCountId, cellCount.id))
              }
            >
              {isViewing ? "Hide from map" : "View on map"}
            </button>
            <button
              type="button"
              className="saved-row-button saved-row-button--primary"
              onClick={() => setSelectedCellCountId(cellCount.id)}
              disabled={!canEdit}
            >
              Edit
            </button>
          </>
        }
      />
    </SavedRow>
  );
}

function SavedCountList() {
  const { cellCounts, status, selectedCellCountId, setSelectedCellCountId } =
    useCellCountStoreContext();
  const { canEdit } = useCollectionContext();
  // Kept here rather than reset on edit, so Back returns to the same results.
  const [search, setSearch] = useState("");
  // One open at a time. Kept through an edit too, so Back lands on it.
  const [openId, setOpenId] = useState<string | null>(null);

  const editing = cellCounts.find((c) => c.id === selectedCellCountId);
  if (editing && canEdit) {
    return (
      <SavedCountEdit
        key={editing.id}
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

  const query = search.trim().toLowerCase();
  const filtered = newestFirst(
    query
      ? cellCounts.filter(
        (c) =>
          c.label.toLowerCase().includes(query) ||
          c.notes.toLowerCase().includes(query),
      )
      : cellCounts,
  );

  return (
    <>
      <input
        type="search"
        className="saved-cell-count-list-search"
        value={search}
        placeholder="Search saved counts"
        onChange={(e) => setSearch(e.target.value)}
      />
      {filtered.length === 0 ? (
        <p className="saved-cell-count-list-empty">No matches.</p>
      ) : (
        <ul className="saved-cell-count-list themed-scroll">
          {filtered.map((cellCount) => (
            <SavedCountRow
              key={cellCount.id}
              cellCount={cellCount}
              open={openId === cellCount.id}
              onToggle={() => setOpenId((current) => (current === cellCount.id ? null : cellCount.id))}
            />
          ))}
        </ul>
      )}
    </>
  );
}

export default SavedCountList;
