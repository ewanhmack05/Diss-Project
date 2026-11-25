import { useCallback, useEffect, useState } from "react";
import { useRealtimeContext } from "../../context/RealtimeContext";
import { isRollbackOp } from "./realtime";

// A box that saves what's in it, and isn't shared live - a group's name or
// notes. It follows what's saved until you type in it, so one that's been sat
// open never saves something old. Someone putting the whole collection back
// takes what you've typed with it.
function useBox(saved: string, onPutBack?: () => void) {
	const { onOp } = useRealtimeContext();
	const [typed, setTyped] = useState<string | null>(null);
	const reset = useCallback(() => setTyped(null), []);

	// What you typed is what's saved now, so back to following it.
	useEffect(() => setTyped((current) => (current === saved ? null : current)), [saved]);

	useEffect(
		() =>
			onOp(({ op }) => {
				if (!isRollbackOp(op)) return;
				reset();
				onPutBack?.();
			}),
		[onOp, reset, onPutBack],
	);

	return { text: typed ?? saved, typed: typed !== null, type: setTyped, reset };
}

export { useBox };
