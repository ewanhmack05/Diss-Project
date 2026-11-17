import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { useAnnotationGroupContext } from "../../../context/AnnotationGroupContext";
import { useAnnotationStoreContext } from "../../../context/AnnotationStoreContext";
import { useAuthContext } from "../../../context/AuthContext";
import { useCollectionContext } from "../../../context/CollectionContext";
import { useLayersContext } from "../../../context/LayersContext";
import GroupPage from "../../annotation/Select/GroupPage";
import { UNGROUPED, groupsIn, isOnlyShown, onlyShowing, peopleIn, reasons, type Chip, type Hidden } from "./layers";
import { useMapTally } from "./useMapTally";
import "./OnTheMap.css";

type Row = keyof Hidden;

// A row shows this many, then "+N more".
const ROW_LIMIT = 12;

const plural = (n: number) => `${n} ${n === 1 ? "annotation" : "annotations"}`;

interface Menu {
	row: Row;
	key: string;
	x: number;
	y: number;
}

// What's on the map from the collection you're in, and why the rest isn't:
// a chip per person and per group, on or off. See docs/layers.md.
function OnTheMapTab({ onSwitch }: { onSwitch: () => void }) {
	const { active, personalCollectionId, canEdit } = useCollectionContext();
	const { annotations, mapFilter, clearSaved } = useAnnotationStoreContext();
	const { groups } = useAnnotationGroupContext();
	const { user } = useAuthContext();
	const { hidden, toggle, setRow, showAll } = useLayersContext();
	const [menu, setMenu] = useState<Menu | null>(null);
	const [expanded, setExpanded] = useState<Record<Row, boolean>>({ people: false, groups: false });
	// A group's own page, in place of the tab, while it's open.
	const [openGroupId, setOpenGroupId] = useState<string | null>(null);

	useEffect(() => {
		if (!menu) return;
		const close = (event: Event) => {
			if (event instanceof KeyboardEvent && event.key !== "Escape") return;
			if (event instanceof PointerEvent && (event.target as HTMLElement).closest(".map-chip-menu")) return;
			setMenu(null);
		};
		window.addEventListener("pointerdown", close);
		window.addEventListener("keydown", close);
		return () => {
			window.removeEventListener("pointerdown", close);
			window.removeEventListener("keydown", close);
		};
	}, [menu]);

	const counts = useMapTally();

	if (!active) return null;

	// Gone if someone else deletes or merges it - back to the chips then.
	const openGroup = groups.find((g) => g.id === openGroupId);
	if (openGroup) return <GroupPage key={openGroup.id} group={openGroup} editable={canEdit} onBack={() => setOpenGroupId(null)} />;

	const rows: Record<Row, Chip[]> = { people: peopleIn(annotations, user.id), groups: groupsIn(annotations, groups) };
	const why = reasons(counts);
	// Something's narrowing what's drawn - the chips, or the open Saved list.
	const anyOff = hidden.people.size > 0 || hidden.groups.size > 0 || mapFilter !== null;
	const everything = () => {
		showAll();
		if (mapFilter) clearSaved();
	};

	// From the row as it is when it's applied - two clicks then a double-click
	// arrive faster than renders. What's hidden comes out of what's picked on
	// the Select tab, which watches for it.
	const only = (row: Row, key: string) =>
		setRow(row, (current) => (isOnlyShown(rows[row], current, key) ? new Set() : onlyShowing(rows[row], key)));

	const title =
		active.collectionId === personalCollectionId
			? "Your own"
			: active.kind === "session"
				? `Session: ${active.collectionName}`
				: active.collectionName;

	const chipRow = (row: Row, heading: string, empty: string, hint?: string) => {
		const chips = rows[row];
		const shown = expanded[row] ? chips : chips.slice(0, ROW_LIMIT);
		return (
			<section className="map-row" aria-label={heading}>
				<h3 className="collections-heading">{heading}</h3>
				{hint && chips.length > 0 && <p className="collections-note">{hint}</p>}
				{chips.length === 0 ? (
					<p className="collections-note">{empty}</p>
				) : (
					<div className="map-chips">
						{shown.map((chip) => {
							const on = !hidden[row].has(chip.key);
							return (
								<button
									key={chip.key}
									type="button"
									className={`map-chip${on ? " map-chip--on" : ""}`}
									aria-pressed={on}
									aria-label={`${chip.name}, ${plural(chip.count)}`}
									title={`${on ? "Click to hide" : "Click to show"} · double-click for only this one`}
									onClick={() => toggle(row, chip.key)}
									// Two clicks have just toggled it and back, so this starts from
									// where it was.
									onDoubleClick={() => only(row, chip.key)}
									onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
										if (event.key === "Enter" && event.shiftKey) {
											event.preventDefault();
											only(row, chip.key);
										}
									}}
									onContextMenu={(event: ReactMouseEvent<HTMLButtonElement>) => {
										event.preventDefault();
										// Where it is on screen - the menu goes on the page, not in the
										// panel, so the panel's edge can't cut it off.
										const at = event.currentTarget.getBoundingClientRect();
										setMenu({ row, key: chip.key, x: at.left, y: at.bottom + 4 });
									}}
								>
									<span className="map-chip-name">{chip.name}</span>
									<span className="map-chip-count">{chip.count}</span>
								</button>
							);
						})}
						{chips.length > ROW_LIMIT && (
							<button type="button" className="map-chip map-chip--more" onClick={() => setExpanded((current) => ({ ...current, [row]: !current[row] }))}>
								{expanded[row] ? "Fewer" : `+${chips.length - ROW_LIMIT} more`}
							</button>
						)}
					</div>
				)}
			</section>
		);
	};

	const menuChip = menu ? rows[menu.row].find((chip) => chip.key === menu.key) : undefined;

	return (
		<div className="map-tab">
			<section className="map-header">
				<div className="map-header-top">
					<span className="map-title" title={title}>
						{title}
					</span>
					<button type="button" className="collections-button" onClick={onSwitch}>
						Switch
					</button>
				</div>
				<p className="collections-note">{canEdit ? "New annotations save here" : "View only - you can't add here"}</p>
				<div
					className="map-bar"
					role="meter"
					aria-label="On the map"
					aria-valuemin={0}
					aria-valuemax={counts.total}
					aria-valuenow={counts.shown}
				>
					<span className="map-bar-fill" style={{ width: counts.total === 0 ? "0%" : `${(counts.shown / counts.total) * 100}%` }} />
				</div>
				<div className="map-count-row">
					<span className="map-count" title={why.length > 1 ? `Off the map: ${why.join(", ")}` : undefined} aria-live="polite">
						{counts.total === 0
							? "Nothing drawn here yet"
							: counts.shown === counts.total
								? `All ${counts.total} shown`
								: `${counts.shown} of ${counts.total} shown · ${why[0]}`}
					</span>
					{anyOff && (
						<button type="button" className="map-link" onClick={everything}>
							Show all
						</button>
					)}
				</div>
				{counts.bySaved > 0 && (
					<p className="collections-note">The Saved list's search and filters are narrowing the map while it's open. Show all clears them.</p>
				)}
			</section>

			{chipRow("people", "People", "Nobody's drawn anything here yet.")}
			{chipRow(
				"groups",
				"Groups",
				canEdit ? "No groups yet - pick some on the Annotations panel's Select tab and make one." : "No groups and nothing drawn yet.",
				groups.length > 0
					? "Right-click a group to open it."
					: canEdit
						? "Make a group from what you pick on the Annotations panel's Select tab."
						: undefined,
			)}

			{menu &&
				menuChip &&
				createPortal(
				<div className="map-chip-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
					<button
						type="button"
						role="menuitem"
						onClick={() => {
							only(menu.row, menu.key);
							setMenu(null);
						}}
					>
						{isOnlyShown(rows[menu.row], hidden[menu.row], menu.key) ? "Show the rest again" : `Only ${menuChip.name}`}
					</button>
					<button
						type="button"
						role="menuitem"
						onClick={() => {
							setRow(menu.row, new Set());
							setMenu(null);
						}}
					>
						Show all {menu.row === "people" ? "people" : "groups"}
					</button>
					{menu.row === "groups" && menu.key !== UNGROUPED && (
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								setOpenGroupId(menu.key);
								setMenu(null);
							}}
						>
							Open group
						</button>
					)}
				</div>,
				document.body,
			)}
		</div>
	);
}

export default OnTheMapTab;
