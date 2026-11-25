import { useEffect, useState } from "react";
import { useAuthContext } from "../../../context/AuthContext";
import { useAnnotationStoreContext } from "../../../context/AnnotationStoreContext";
import SavedPager from "../../saved/SavedPager";
import { SAVED_PAGE_SIZE, clampPage } from "../../saved/paging";
import DeletedRowButton from "./DeletedRowButton";
import { deletedCount, deletedPath, type DeletedPage } from "./changes";
import type { Item } from "./itemVersions";

// Where you are in it.
interface DeletedView {
	page: number;
	search: string;
}

const SETTLE_MS = 250;

// Everything one change deleted, a page at a time, searched by name. Each one
// that has a timeline opens it.
function DeletedList({
	changeSetId,
	total,
	view,
	onView,
	onOpenItem,
}: {
	changeSetId: string;
	// How many it deleted in all.
	total: number;
	view: DeletedView;
	onView: (view: DeletedView | null) => void;
	onOpenItem: (item: Item) => void;
}) {
	const { authFetch } = useAuthContext();
	const { baseUrl } = useAnnotationStoreContext();
	const { page, search } = view;
	// The last page stays up while the next one loads, so it doesn't flash empty.
	const [loaded, setLoaded] = useState<{ result: DeletedPage; search: string } | null>(null);
	const [failed, setFailed] = useState(false);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		const timer = setTimeout(
			() => {
				authFetch(`${baseUrl}${deletedPath(changeSetId, search, page * SAVED_PAGE_SIZE, SAVED_PAGE_SIZE)}`)
					.then((response) => {
						if (!response.ok) throw new Error(String(response.status));
						return response.json() as Promise<DeletedPage>;
					})
					.then((result) => {
						if (cancelled) return;
						setLoaded({ result, search });
						setFailed(false);
					})
					.catch(() => {
						if (!cancelled) setFailed(true);
					})
					.finally(() => {
						if (!cancelled) setLoading(false);
					});
			},
			search.trim() ? SETTLE_MS : 0,
		);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [authFetch, baseUrl, changeSetId, page, search]);

	return (
		<div className="history-deleted-all-list">
			<input
				type="search"
				className="history-deleted-search"
				placeholder="Search what was deleted"
				aria-label="Search what was deleted"
				value={search}
				onChange={(event) => onView({ page: 0, search: event.target.value })}
			/>
			{failed && <p className="collections-note">Couldn't load what was deleted.</p>}
			{!failed && !loaded && <p className="collections-note">Loading…</p>}
			{!failed && loaded && (
				<>
					<p className="history-deleted-count" aria-live="polite">
						{deletedCount(total, loaded.result.total, loaded.search)}
					</p>
					<div className="history-deleted-rows">
						{loaded.result.rows.map((row) => (
							<DeletedRowButton key={row.id} row={row} onOpenItem={onOpenItem} />
						))}
					</div>
					<SavedPager
						page={clampPage(page, loaded.result.total, SAVED_PAGE_SIZE)}
						total={loaded.result.total}
						pageSize={SAVED_PAGE_SIZE}
						loading={loading}
						onPage={(next) => onView({ page: next, search })}
					/>
				</>
			)}
			<button type="button" className="history-deleted-all" onClick={() => onView(null)}>
				Show fewer
			</button>
		</div>
	);
}

export default DeletedList;
export type { DeletedView };
