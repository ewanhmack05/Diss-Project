import { useCallback } from "react";
import { useCollectionContext } from "../../context/CollectionContext";
import { useEmitEvent } from "../../context/EventContext";
import { useMessagingContext } from "../../context/MessagingContext";
import { nothingToKeep } from "../collections/shared-collection/sessions";

// Ending a session that nothing happened in deletes it, so the Collections
// tab doesn't fill up with empty ones. Asked before, to say so in the
// confirm, and again after ending - someone may have drawn or said something
// in between, and then it's kept. Both load the list fresh: its counts are
// only kept up to date while the Collections panel is open.
function useEndSession() {
	const { refresh, deleteSession } = useCollectionContext();
	const { chatSaid } = useMessagingContext();
	const emit = useEmitEvent();

	const wouldDrop = useCallback(
		async (sessionId: string) => {
			const session = (await refresh())?.find((c) => c.collectionId === sessionId);
			return !!session && nothingToKeep(session, await chatSaid(sessionId));
		},
		[refresh, chatSaid],
	);

	// Call once it's ended (and the room's been told). Loads the list again
	// either way, which ending needs anyway. True if it was deleted.
	const dropIfEmpty = useCallback(
		async (sessionId: string) => {
			if (!(await wouldDrop(sessionId))) return false;
			await deleteSession(sessionId);
			emit("session:dropped", { collectionId: sessionId });
			return true;
		},
		[wouldDrop, deleteSession, emit],
	);

	return { wouldDrop, dropIfEmpty };
}

export { useEndSession };
