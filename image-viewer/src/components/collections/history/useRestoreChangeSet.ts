import { useEffect, useRef } from "react";
import { useAuthContext } from "../../../context/AuthContext";
import { useCollectionContext } from "../../../context/CollectionContext";
import { useAnnotationStoreContext } from "../../../context/AnnotationStoreContext";
import { useCellCountStoreContext } from "../../../context/CellCountStoreContext";
import { useAnnotationGroupContext } from "../../../context/AnnotationGroupContext";
import { useCellCountGroupContext } from "../../../context/CellCountGroupContext";
import { useAdjustmentsContext } from "../../../context/AdjustmentsContext";
import { useRealtimeContext } from "../../../context/RealtimeContext";
import { useEmitEvent } from "../../../context/EventContext";
import { useToastContext } from "../../../context/ToastContext";
import { restorePath } from "../../annotation/bulk";
import { usePutText } from "../../realtime/usePutText";
import { textToPut } from "../../realtime/putText";
import { textAt } from "../../realtime/storedText";
import { restoredMessage, restoredOps, type ChangeSet, type Restored } from "./history";

// Puts back what a change set deleted, for everyone: annotation-store
// restores it, the rows it answers with go back on the map and in the
// Saved lists here, and everyone else gets a create per row. Anyone with one
// open sees its old label and notes come back. Resolves once it's done, toast and all - rejects if annotation-store said no.
function useRestoreChangeSet(): (changeSet: ChangeSet) => Promise<void> {
	const { authFetch } = useAuthContext();
	const { collectionId, refresh } = useCollectionContext();
	const annotationStore = useAnnotationStoreContext();
	const cellCountStore = useCellCountStoreContext();
	const groups = useAnnotationGroupContext();
	const countGroups = useCellCountGroupContext();
	const adjustments = useAdjustmentsContext();
	const { sendOp } = useRealtimeContext();
	const putText = usePutText();
	const emit = useEmitEvent();
	const { addToast } = useToastContext();
	// Moving to another collection while it's on its way mustn't put its
	// rows in that one's lists.
	const collectionIdRef = useRef(collectionId);
	useEffect(() => {
		collectionIdRef.current = collectionId;
	}, [collectionId]);

	return async (changeSet: ChangeSet) => {
		let restored: Restored;
		let at: number | undefined;
		try {
			const response = await authFetch(`${annotationStore.baseUrl}${restorePath(changeSet.id)}`, { method: "POST" });
			if (!response.ok) throw new Error(String(response.status));
			restored = (await response.json()) as Restored;
			at = textAt(response);
		} catch (error) {
			emit("annotations:restored:error", { count: changeSet.deleted });
			throw error;
		}

		if (collectionIdRef.current === changeSet.collectionId) {
			const texts = [
				...textToPut("annotation", restored.changedAnnotations ?? [], restored.textWas),
				...textToPut("cellCount", restored.changedCellCounts ?? [], restored.textWas),
			];
			groups.addRestored([...restored.groups, ...(restored.changedGroups ?? [])]);
			annotationStore.addRestored([...restored.annotations, ...(restored.changedAnnotations ?? [])], at);
			countGroups.addRestored([...(restored.cellCountGroups ?? []), ...(restored.changedCellCountGroups ?? [])]);
			cellCountStore.addRestored([...restored.cellCounts, ...(restored.changedCellCounts ?? [])], at);
			adjustments.addRestored(restored.imageAdjustments);
			// Forms first, so nobody's typing is saved on top of text their box
			// hasn't got yet.
			void Promise.allSettled(texts.map(putText)).then(() => restoredOps(restored, at).forEach(sendOp));
		}
		if (restored.counts.collection) refresh();
		emit("changeset:restored", { id: changeSet.id, counts: restored.counts });
		addToast(restoredMessage(restored.counts), "success");
	};
}

export default useRestoreChangeSet;
