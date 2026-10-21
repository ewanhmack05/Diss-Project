import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useCellCountStoreContext } from "../../../context/CellCountStoreContext";
import type { CellCount } from "../../../interfaces/CellCount";
import { countSummary } from "../CellCountDots";
import { toggleViewedCellCountId } from "../CellCountView";
import CellCountColourSwatch from "../CellCountColourSwatch";
import SavedCountEdit from "./SavedCountEdit";
import SavedRow, { SavedDetails } from "../../saved/SavedRow";
import { formatLongDate, formatShortDate } from "../../saved/savedDates";
import { SAVED_PAGE_SIZE, clampPage, isFiltered, mergePage } from "../../saved/paging";
import { NO_FILTERS, type SavedFilters } from "../../saved/filters";
import SavedFilterMenu from "../../saved/SavedFilterMenu";
import { useSavedFacets } from "../../saved/useSavedFacets";
import useSavedPage from "../../saved/useSavedPage";
import SavedPager from "../../saved/SavedPager";
import { savedBy } from "../../saved/savedBy";
import { useAuthContext } from "../../../context/AuthContext";
import { useCollectionContext } from "../../../context/CollectionContext";
import type { ListTotal } from "../../saved/useSavedTotal";
import Icon from "../../../icons/Icon";
import peopleSvg from "../../../icons/people.svg?raw";
import roiSvg from "../../../icons/roi.svg?raw";
import "./SavedCountList.css";

function RoiIcon() {
  return (
    <Icon svg={roiSvg} size={11} />
  );
}

function PeopleIcon() {
  return (
    <Icon svg={peopleSvg} size={13} height={11} />
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
  // From the summary the list sends - the dots themselves only load for
  // View on map. Memoised for a count you've just saved, which is worked
  // out from its dots.
  const { colourCounts, placedByCounts, dots } = cellCount;
  const { colours, people } = useMemo(
    () => countSummary({ colourCounts, placedByCounts, dots }),
    [colourCounts, placedByCounts, dots],
  );
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

// onTotal hears how many the list is showing, for the tab's label - null
// while it's loading, and once it's closed.
function SavedCountList({ onTotal }: { onTotal?: (total: ListTotal | null) => void }) {
  const {
    cellCounts,
    status,
    revision,
    wasDeleted,
    baseUrl,
    rememberCellCounts,
    selectedCellCountId,
    setSelectedCellCountId,
    seenTotal,
  } = useCellCountStoreContext();
  const { canEdit, collectionId } = useCollectionContext();
  const { user } = useAuthContext();
  // Kept here rather than reset on edit, so Back returns to the same results.
  const [search, setSearch] = useState("");
  // Same as the search - kept through an edit, and back to the first page
  // when changed.
  const [filters, setFilters] = useState<SavedFilters>(NO_FILTERS);
  // One open at a time. Kept through an edit too, so Back lands on it.
  const [openId, setOpenId] = useState<string | null>(null);
  // Kept through an edit too, and reset to the first page by a new search.
  const [page, setPage] = useState(0);
  // A page at a time from annotation-store, searched there too - all of
  // them at once meant every count's dots, which ran to tens of megabytes.
  const savedPage = useSavedPage<CellCount>({
    baseUrl,
    path: "cellcounts",
    collectionId,
    page,
    pageSize: SAVED_PAGE_SIZE,
    search,
    filters,
    revision,
  });
  const facets = useSavedFacets(baseUrl, "cellcounts", collectionId, revision);
  // An unfiltered page knows the whole collection's total - pass it on, so
  // the tab still says it once the list's closed.
  useEffect(() => {
    if (savedPage.status === "ready" && !savedPage.filtered) seenTotal(savedPage.total, savedPage.at, savedPage.asked);
  }, [savedPage.status, savedPage.filtered, savedPage.total, savedPage.at, savedPage.asked, seenTotal]);
  // So View and Edit find a count from this page in the store.
  useEffect(() => {
    rememberCellCounts(savedPage.fetched);
  }, [savedPage.fetched, rememberCellCounts]);

  // Worked out before anything's shown, so the tab has it during an edit too.
  const { items, total } = mergePage({
    fetched: savedPage.fetched,
    total: savedPage.total,
    live: cellCounts,
    isDeleted: wasDeleted,
    page,
    search,
    filters,
    pageSize: SAVED_PAGE_SIZE,
  });
  const ready = status === "ready" && savedPage.status === "ready";
  const filtered = isFiltered(search, filters);
  useEffect(() => {
    onTotal?.(ready ? { total, filtered } : null);
  }, [onTotal, ready, total, filtered]);
  useEffect(() => () => onTotal?.(null), [onTotal]);

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

  if (status === "loading" || savedPage.status === "loading") {
    return <p className="saved-cell-count-list-empty">Loading...</p>;
  }

  if (status === "error" || savedPage.status === "error") {
    return (
      <p className="saved-cell-count-list-empty">
        Couldn't reach the annotation store.
      </p>
    );
  }

  // A delete can leave this page past the end - step back to the last one.
  const shownPage = clampPage(page, total, SAVED_PAGE_SIZE);
  if (shownPage !== page) setPage(shownPage);

  if (total === 0 && !isFiltered(search, filters)) {
    return <p className="saved-cell-count-list-empty">Nothing saved yet.</p>;
  }

  return (
    <>
      <div className="saved-search-row">
        <input
          type="search"
          className="saved-cell-count-list-search"
          value={search}
          placeholder="Search saved counts"
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <SavedFilterMenu
          filters={filters}
          onChange={(next) => {
            setFilters(next);
            setPage(0);
          }}
          facets={facets}
          myId={user.id}
          roi
        />
      </div>
      {items.length === 0 ? (
        <p className="saved-cell-count-list-empty">{savedPage.loadingMore ? "Searching..." : "No matches."}</p>
      ) : (
        <ul className="saved-cell-count-list themed-scroll">
          {items.map((cellCount) => (
            <SavedCountRow
              key={cellCount.id}
              cellCount={cellCount}
              open={openId === cellCount.id}
              onToggle={() => setOpenId((current) => (current === cellCount.id ? null : cellCount.id))}
            />
          ))}
        </ul>
      )}
      <SavedPager
        page={page}
        total={total}
        pageSize={SAVED_PAGE_SIZE}
        loading={savedPage.loadingMore}
        onPage={setPage}
      />
    </>
  );
}

export default SavedCountList;
