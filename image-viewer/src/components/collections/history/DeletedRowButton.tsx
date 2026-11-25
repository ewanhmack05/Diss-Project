import { deletedRowText, type DeletedRow } from "./changes";
import { isItemEntity, type Item } from "./itemVersions";

// One row a change deleted - a link to its timeline, or just its name if it's
// something that hasn't got one.
function DeletedRowButton({ row, onOpenItem }: { row: DeletedRow; onOpenItem: (item: Item) => void }) {
	const { entity, id, name } = row;
	if (!isItemEntity(entity)) return <span className="history-deleted-row history-deleted-row--plain">{deletedRowText(row)}</span>;
	return (
		<button type="button" className="history-deleted-row" onClick={() => onOpenItem({ entity, id, name })}>
			{deletedRowText(row)}
		</button>
	);
}

export default DeletedRowButton;
