import { useEffect, useState } from "react";
import { useCellCountGroupContext } from "../../../context/CellCountGroupContext";
import { useCollectionContext } from "../../../context/CollectionContext";
import { useDialogContext } from "../../../context/DialogContext";
import { useMessagingContext } from "../../../context/MessagingContext";
import Icon from "../../../icons/Icon";
import chevronLeftSvg from "../../../icons/chevron-left.svg?raw";
import type { CellCountGroup } from "../../../interfaces/CellCountGroup";
import "../../annotation/Select/Select.css";

const plural = (n: number) => `${n} ${n === 1 ? "count" : "counts"}`;

function useDeleteGroup() {
	const { deleteGroup } = useCellCountGroupContext();
	const { showDialog } = useDialogContext();
	return (group: CellCountGroup, then?: () => void) =>
		showDialog({
			title: `Delete ${group.name}?`,
			message: group.count > 0 ? `The ${plural(group.count)} in it stay - they just won't be in a group.` : "It's empty, so nothing else changes.",
			actions: [
				{
					label: "Delete group",
					variant: "danger",
					onClick: () =>
						deleteGroup(group.id)
							.then(then)
							.catch(() => {}),
				},
				{ label: "Cancel" },
			],
		});
}

function SendGroup({ group, wide }: { group: CellCountGroup; wide?: boolean }) {
	const { status, sendToSomeone } = useMessagingContext();
	if (status === "off") return null;
	return (
		<button
			type="button"
			className={`select-button${wide ? " select-button--wide" : ""}`}
			disabled={group.count === 0}
			title={group.count === 0 ? "There's nothing in it to send" : undefined}
			onClick={() => sendToSomeone({ label: `Group: ${group.name}`, pick: { kind: "cellCountGroup", id: group.id } })}
		>
			Send
		</button>
	);
}

interface CountGroupPageProps {
	group: CellCountGroup;
	onBack: () => void;
	onShow: () => void;
}

// One group's own page - its name, notes, and what can be done with all of it.
function CountGroupPage({ group, onBack, onShow }: CountGroupPageProps) {
	const { groups, updateGroup, mergeGroup } = useCellCountGroupContext();
	const { canEdit } = useCollectionContext();
	const { showDialog } = useDialogContext();
	const confirmDelete = useDeleteGroup();
	const [mergeInto, setMergeInto] = useState("");
	const others = groups.filter((g) => g.id !== group.id);
	const target = others.find((g) => g.id === mergeInto);
	const [name, setName] = useState(group.name);
	const [notes, setNotes] = useState(group.notes);
	const [editing, setEditing] = useState(false);

	// Someone else's change comes through, unless you're in the middle of yours.
	useEffect(() => {
		if (editing) return;
		setName(group.name);
		setNotes(group.notes);
	}, [group.name, group.notes, editing]);

	const saveName = () => {
		setEditing(false);
		const tidy = name.trim();
		if (!tidy) setName(group.name);
		else if (tidy !== group.name) updateGroup(group.id, { name: tidy }).catch(() => setName(group.name));
	};

	const saveNotes = () => {
		setEditing(false);
		if (notes !== group.notes) updateGroup(group.id, { notes }).catch(() => setNotes(group.notes));
	};

	const confirmMerge = () => {
		if (!target) return;
		showDialog({
			title: `Merge ${group.name} into ${target.name}?`,
			message: `${group.count > 0 ? `Its ${plural(group.count)} move into ${target.name}, and ${group.name} goes.` : `${group.name} goes.`} Any notes are kept. You can put it back from History.`,
			actions: [
				{
					label: "Merge",
					variant: "accent",
					onClick: () =>
						mergeGroup(group.id, target.id)
							.then(onBack)
							.catch(() => {}),
				},
				{ label: "Cancel" },
			],
		});
	};

	return (
		<div className="select-tab">
			<button type="button" className="select-back" onClick={onBack}>
				<Icon svg={chevronLeftSvg} size={12} />
				Saved
			</button>
			<section className="select-section">
				{canEdit ? (
					<input
						className="select-page-name"
						aria-label="Group name"
						value={name}
						maxLength={64}
						onFocus={() => setEditing(true)}
						onChange={(e) => setName(e.target.value)}
						onBlur={saveName}
						onKeyDown={(e) => {
							if (e.key === "Enter") e.currentTarget.blur();
						}}
					/>
				) : (
					<h2 className="select-page-title">{group.name}</h2>
				)}
				<div className="select-count-row">
					<span className="select-count">{plural(group.count)}</span>
					<button type="button" className="select-button" disabled={group.count === 0} onClick={onShow}>
						Show in the list
					</button>
				</div>
			</section>
			<section className="select-section">
				<h3 className="select-heading">Notes</h3>
				{canEdit ? (
					<textarea
						className="select-notes"
						aria-label="Group notes"
						rows={4}
						maxLength={10000}
						value={notes}
						onFocus={() => setEditing(true)}
						onChange={(e) => setNotes(e.target.value)}
						onBlur={saveNotes}
					/>
				) : (
					<p className="select-hint">{group.notes || "No notes."}</p>
				)}
			</section>
			<SendGroup group={group} wide />
			{canEdit && others.length > 0 && (
				<section className="select-section">
					<h3 className="select-heading">Merge</h3>
					<div className="select-row">
						<select aria-label="Merge into" value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
							<option value="">Into…</option>
							{others.map((g) => (
								<option key={g.id} value={g.id}>
									{g.name}
								</option>
							))}
						</select>
						<button type="button" className="select-button" disabled={!target} onClick={confirmMerge}>
							Merge
						</button>
					</div>
				</section>
			)}
			{canEdit && (
				<button type="button" className="select-button select-button--danger select-button--wide" onClick={() => confirmDelete(group, onBack)}>
					Delete group
				</button>
			)}
		</div>
	);
}

interface CountGroupsProps {
	// Opens a group's page in place of the list.
	onOpen: (groupId: string) => void;
}

// The collection's groups of counts, above the Saved list. Folded away until
// it's wanted, since most of the time the list is what you came for.
function CountGroups({ onOpen }: CountGroupsProps) {
	const { groups, createGroup } = useCellCountGroupContext();
	const { canEdit } = useCollectionContext();
	const confirmDelete = useDeleteGroup();
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);

	const make = () => {
		const tidy = name.trim();
		if (!tidy || busy) return;
		setBusy(true);
		createGroup(tidy)
			.then(() => setName(""))
			.catch(() => {})
			.finally(() => setBusy(false));
	};

	return (
		<details className="saved-count-groups">
			<summary className="select-heading saved-count-groups-title">Groups ({groups.length})</summary>
			{groups.length === 0 && !canEdit && <p className="select-hint">No groups in this collection.</p>}
			{groups.length > 0 && (
				<ul className="select-groups">
					{groups.map((group) => (
						<li key={group.id} className="select-group">
							<button type="button" className="select-group-name" title={`Open ${group.name}`} onClick={() => onOpen(group.id)}>
								{group.name}
							</button>
							<span className="select-group-count">{group.count}</span>
							<SendGroup group={group} />
							{canEdit && (
								<button
									type="button"
									className="select-icon-button select-icon-button--danger"
									aria-label={`Delete ${group.name}`}
									onClick={() => confirmDelete(group)}
								>
									×
								</button>
							)}
						</li>
					))}
				</ul>
			)}
			{canEdit && (
				<form
					className="select-row"
					onSubmit={(e) => {
						e.preventDefault();
						make();
					}}
				>
					<input aria-label="New group name" placeholder="New group" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
					<button type="submit" className="select-button select-button--accent" disabled={busy || !name.trim()}>
						Add
					</button>
				</form>
			)}
		</details>
	);
}

export { CountGroupPage, CountGroups };
