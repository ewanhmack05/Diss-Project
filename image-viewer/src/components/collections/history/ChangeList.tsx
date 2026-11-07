import { useEffect, useState } from "react";
import { useAuthContext } from "../../../context/AuthContext";
import { useAnnotationStoreContext } from "../../../context/AnnotationStoreContext";
import ChangeLineItem from "./ChangeLines";
import { changeLines, deletedLine, deletedMore, type ChangeSetChanges } from "./changes";
import { isItemEntity, type Item } from "./itemVersions";

type Loaded = { status: "loading" } | { status: "error" } | { status: "ready"; result: ChangeSetChanges };

// What one change did - each field it changed, from and to, and what it
// deleted by name, each one that has a timeline opening it. Loaded when the
// change is opened, not with the list.
function ChangeList({ changeSetId, onOpenItem }: { changeSetId: string; onOpenItem?: (item: Item) => void }) {
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
	// Links in place of the names, when every row it names can be opened - a
	// change's deleted rows are all one kind unless something's odd.
	const named = loaded.result.deletedRows ?? [];
	const openable = named.every((row) => isItemEntity(row.entity)) ? named : [];
	const more = deletedMore(loaded.result);

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
						{onOpenItem && openable.length > 0 ? (
							<div className="history-deleted-rows">
								{openable.map(({ entity, id, name }) => (
									<button
										type="button"
										key={id}
										className="history-deleted-row"
										onClick={() => onOpenItem({ entity: entity as Item["entity"], id, name })}
									>
										{name || "one with no name"}
									</button>
								))}
								{more && <span className="history-deleted-more">{more}</span>}
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
