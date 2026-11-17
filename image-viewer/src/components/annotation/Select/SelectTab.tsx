import { useEffect, useState } from "react";
import { useAnnotationGroupContext } from "../../../context/AnnotationGroupContext";
import { useAnnotationSelectContext, type SelectMode } from "../../../context/AnnotationSelectContext";
import { UNDO_DELETE_MS, useAnnotationStoreContext } from "../../../context/AnnotationStoreContext";
import { useCellCountDrawContext } from "../../../context/CellCountDrawContext";
import { useCollectionContext } from "../../../context/CollectionContext";
import { useDialogContext } from "../../../context/DialogContext";
import { useLayersContext } from "../../../context/LayersContext";
import { useMessagingContext } from "../../../context/MessagingContext";
import { useToastContext } from "../../../context/ToastContext";
import { useToolbarContext } from "../../../context/ToolbarContext";
import ColourPicker from "../../colour-picker/ColourPicker";
import { isShown, shownInGroup } from "../../collections/map/layers";
import { DefaultColour } from "../Tools";
import "./Select.css";

const MODES: { mode: SelectMode; label: string; hint: string }[] = [
	{ mode: "box", label: "Box", hint: "Drag a box" },
	{ mode: "lasso", label: "Lasso", hint: "Draw round them" },
];

const plural = (n: number) => `${n} ${n === 1 ? "annotation" : "annotations"}`;

// Picking many annotations on the map at once - by box, lasso, clicking them
// or a whole group - to recolour, group, send or delete together. Editors
// only. Groups themselves - showing, hiding and their pages - are on the
// Collections panel's On the map tab.
function SelectTab() {
	const { setSelecting, mode, setMode, selectedIds, select, clear } = useAnnotationSelectContext();
	const { annotations, updateMany, deleteMany } = useAnnotationStoreContext();
	const { groups, createGroup } = useAnnotationGroupContext();
	const { hidden } = useLayersContext();
	const { canEdit } = useCollectionContext();
	const { counting } = useCellCountDrawContext();
	const { showDialog } = useDialogContext();
	const { status: messaging, sendToSomeone } = useMessagingContext();
	const { addToast } = useToastContext();
	const { openTool } = useToolbarContext();
	const [colour, setColour] = useState(DefaultColour);
	const [newName, setNewName] = useState("");
	const [addTo, setAddTo] = useState("");
	const [busy, setBusy] = useState(false);

	// Clicks on the map are counting's while a count's going.
	const active = canEdit && !counting;
	useEffect(() => {
		setSelecting(active);
		return () => setSelecting(false);
	}, [active, setSelecting]);

	// Leaving the tab clears what's picked - see useClearPickedOnLeave. What's
	// hidden stays hidden: that's the On the map tab's, until you move collection.

	// Hidden things can't be picked, so anything hidden on the On the map tab
	// comes out of what's picked.
	useEffect(() => {
		const stillShown = [...selectedIds].filter((id) => {
			const annotation = annotations.find((a) => a.id === id);
			return !annotation || isShown(annotation, hidden);
		});
		if (stillShown.length !== selectedIds.size) select(stillShown, false);
		// Only when what's hidden changes - picking more is picking what's shown.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [hidden]);

	// The Annotations panel only offers this tab to editors, but you can lose
	// edit while on it - the session ending, or the host making you a viewer.
	if (!canEdit) return <p className="select-hint">You can only look at this collection now, not change it.</p>;

	const ids = [...selectedIds];
	const visible = annotations.filter((a) => isShown(a, hidden));
	const hint = MODES.find((m) => m.mode === mode)!.hint;
	const inAGroup = annotations.filter((a) => a.groupId && selectedIds.has(a.id)).length;
	const shownIn = (groupId: string) => shownInGroup(annotations, groupId, hidden);
	// The group picked to add to, if it's still there.
	const target = groups.find((g) => g.id === addTo);
	const adding = target ? ids.filter((id) => annotations.find((a) => a.id === id)?.groupId !== target.id).length : 0;

	const newGroup = () => {
		if (!newName.trim() || busy) return;
		setBusy(true);
		createGroup(newName.trim(), ids)
			.then(() => setNewName(""))
			.catch(() => {})
			.finally(() => setBusy(false));
	};

	const confirmDelete = () =>
		showDialog({
			title: `Delete ${plural(ids.length)}?`,
			message: "They'll be gone for everyone in this collection. You'll have a few seconds to undo it.",
			actions: [
				{
					label: "Delete",
					variant: "danger",
					onClick: () => {
						const undo = deleteMany(ids);
						if (!undo) return;
						addToast(`Deleted ${plural(ids.length)}`, "success", {
							actions: [{ label: "Undo", primary: true, onClick: undo }],
							duration: UNDO_DELETE_MS - 500,
						});
					},
				},
				{ label: "Cancel" },
			],
		});

	return (
		<div className="select-tab">
			<section className="select-section">
				<div className="select-segmented" role="group" aria-label="Select by">
					{MODES.map((m) => (
						<button
							key={m.mode}
							type="button"
							aria-pressed={mode === m.mode}
							className={`select-segment${mode === m.mode ? " select-segment--active" : ""}`}
							onClick={() => setMode(m.mode)}
						>
							{m.label}
						</button>
					))}
				</div>
				<p className="select-hint">
					{counting
						? "Finish counting to pick annotations on the map."
						: `${hint} to pick everything fully inside it. Hold Shift to add to what's picked, click a shape to put it in or take it out, Esc to clear. Hold Space or drag with the middle button to move the map.`}
				</p>
			</section>

			<div className="select-count-row">
				<span className="select-count">{ids.length > 0 ? `${plural(ids.length)} picked` : "Nothing picked"}</span>
				<button
					type="button"
					className="select-button"
					disabled={visible.length === 0}
					onClick={() =>
						select(
							visible.map((a) => a.id),
							false,
						)
					}
				>
					All
				</button>
				<button type="button" className="select-button" disabled={ids.length === 0} onClick={clear}>
					Clear
				</button>
			</div>

			{groups.length > 0 && (
				<div className="select-row">
					<select
						aria-label="Pick a group"
						value=""
						onChange={(e) => {
							if (e.target.value) select(shownIn(e.target.value), false);
						}}
					>
						<option value="">Pick a group…</option>
						{groups.map((group) => {
							const count = shownIn(group.id).length;
							return (
								<option key={group.id} value={group.id} disabled={count === 0}>
									{group.name} ({count})
								</option>
							);
						})}
					</select>
				</div>
			)}

			{ids.length > 0 && (
				<>
					{messaging !== "off" && (
						<button
							type="button"
							className="select-button select-button--wide"
							onClick={() => sendToSomeone({ label: plural(ids.length), pick: { kind: "annotations", ids } })}
						>
							Send {plural(ids.length)}
						</button>
					)}
					<section className="select-section">
						<h3 className="select-heading">Colour</h3>
						<ColourPicker value={colour} onChange={setColour} />
						<button type="button" className="select-button select-button--wide" onClick={() => updateMany(ids, { colour })}>
							Recolour {plural(ids.length)}
						</button>
					</section>

					<section className="select-section">
						<h3 className="select-heading">Group</h3>
						<form
							className="select-row"
							onSubmit={(e) => {
								e.preventDefault();
								newGroup();
							}}
						>
							<input aria-label="New group name" placeholder="New group" value={newName} maxLength={64} onChange={(e) => setNewName(e.target.value)} />
							<button type="submit" className="select-button select-button--accent" disabled={busy || !newName.trim()}>
								Group {ids.length}
							</button>
						</form>
						{groups.length > 0 && (
							<form
								className="select-row"
								onSubmit={(e) => {
									e.preventDefault();
									if (target && adding > 0) updateMany(ids, { groupId: target.id });
								}}
							>
								<select aria-label="Add to a group" value={target ? addTo : ""} onChange={(e) => setAddTo(e.target.value)}>
									<option value="">Add to a group…</option>
									{groups.map((group) => (
										<option key={group.id} value={group.id}>
											{group.name}
										</option>
									))}
								</select>
								<button type="submit" className="select-button" disabled={!target || adding === 0}>
									{target && adding > 0 ? `Add ${adding}` : "Add"}
								</button>
							</form>
						)}
						{inAGroup > 0 && (
							<button type="button" className="select-button" onClick={() => updateMany(ids, { groupId: null })}>
								Take {inAGroup === ids.length ? "them" : inAGroup} out of their groups
							</button>
						)}
					</section>

					<button type="button" className="select-button select-button--danger select-button--wide" onClick={confirmDelete}>
						Delete {plural(ids.length)}
					</button>
				</>
			)}

			<p className="select-hint">
				Groups are shown, hidden and opened on the{" "}
				<button type="button" className="select-link" onClick={() => openTool("collections")}>
					Collections panel
				</button>
				.
			</p>
		</div>
	);
}

export default SelectTab;
