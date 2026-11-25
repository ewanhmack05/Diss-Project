import { useEffect, useState } from "react";
import { useAuthContext } from "../../../context/AuthContext";
import { useAnnotationStoreContext } from "../../../context/AnnotationStoreContext";
import ChangeLineItem from "./ChangeLines";
import DeletedRowButton from "./DeletedRowButton";
import DeletedList, { type DeletedView } from "./DeletedList";
import { changeLines, deletedLine, showAllDeleted, type ChangeSetChanges } from "./changes";
import { isItemEntity, type Item } from "./itemVersions";

type Loaded = { status: "loading" } | { status: "error" } | { status: "ready"; result: ChangeSetChanges };

// What one change did - each field it changed, from and to, and what it
// deleted by name, each one that has a timeline opening it. The first few are
// named, and Show all lists the rest. Loaded when the change is opened, not
// with the list.
function ChangeList({
	changeSetId,
	onOpenItem,
	allDeleted = null,
	onAllDeleted,
}: {
	changeSetId: string;
	onOpenItem?: (item: Item) => void;
	// Everything it deleted, opened up - null for just the first few. Kept by
	// whoever has this open, so opening one and coming back lands here again.
	allDeleted?: DeletedView | null;
	onAllDeleted?: (view: DeletedView | null) => void;
}) {
	const { authFetch } = useAuthContext();
	const { baseUrl } = useAnnotationStoreContext();
	const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });

	useEffect(() => {
		let cancelled = false;
		authFetch(`${baseUrl}/changesets/${encodeURIComponent(changeSetId)}/changes`)
			.then((response) => {
				if (!response.ok) throw new Error(String(response.status));
				return response.json() as Promise<ChangeSetChanges>;
			})
			.then((result) => {
				if (!cancelled) setLoaded({ status: "ready", result });
			})
			.catch(() => {
				if (!cancelled) setLoaded({ status: "error" });
			});
		return () => {
			cancelled = true;
		};
	}, [authFetch, baseUrl, changeSetId]);

	if (loaded.status === "loading") return <p className="collections-note">Loading what changed…</p>;
	if (loaded.status === "error") return <p className="collections-note">Couldn't load what changed.</p>;

	const lines = changeLines(loaded.result);
	const deleted = deletedLine(loaded.result);
	if (lines.length === 0 && !deleted) {
		// An add needs nothing more than its label says.
		if (loaded.result.created > 0) return null;
		return (
			<p className="collections-note">
				Nothing was recorded for this change - it's from before changes were kept, or it saved what was already there.
			</p>
		);
	}

	// Said once when every line is about the same rows - an edit to one
	// annotation shouldn't name it on every field. Not with a delete, or the
	// rows it names would read as the ones deleted.
	const rows = !deleted && lines.length > 0 && lines.every((line) => line.rows === lines[0].rows) ? lines[0].rows : null;
	// Links in place of the names, when there's one to open.
	const named = loaded.result.deletedRows ?? [];
	const openable = named.filter((row) => isItemEntity(row.entity));
	const all = onOpenItem && onAllDeleted ? showAllDeleted(loaded.result) : null;

	return (
		<section className="history-changes">
			<h4 className="history-changes-heading">What changed</h4>
			{rows && <p className="history-change-on">{rows}</p>}
			<ul className="history-change-list">
				{deleted && (
					<li className="history-change">
						<div className="history-change-head">
							<span className="history-change-field">Deleted</span>
						</div>
						{onOpenItem && onAllDeleted && allDeleted ? (
							<DeletedList
								changeSetId={changeSetId}
								total={loaded.result.deleted}
								view={allDeleted}
								onView={onAllDeleted}
								onOpenItem={onOpenItem}
							/>
						) : onOpenItem && (openable.length > 0 || all) ? (
							<div className="history-deleted-rows">
								{named.map((row) => (
									<DeletedRowButton key={row.id} row={row} onOpenItem={onOpenItem} />
								))}
								{all && (
									<button type="button" className="history-deleted-all" onClick={() => onAllDeleted?.({ page: 0, search: "" })}>
										{all}
									</button>
								)}
							</div>
						) : (
							<div className="history-change-values">{deleted}</div>
						)}
					</li>
				)}
				{lines.map((line, i) => (
					<ChangeLineItem key={i} line={line} rows={rows ? undefined : line.rows} />
				))}
			</ul>
		</section>
	);
}

export default ChangeList;
