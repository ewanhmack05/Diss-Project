import { useEffect, useRef } from "react";
import { useImageViewerContext } from "../../context/ImageViewerContext";
import { useDrawContext } from "../../context/DrawContext";
import { useCellCountDrawContext } from "../../context/CellCountDrawContext";
import { useComparisonContext } from "../../context/ComparisonContext";
import { useSharedCountContext } from "../../context/SharedCountContext";
import { useCollectionContext } from "../../context/CollectionContext";
import { useAnnotationStoreContext } from "../../context/AnnotationStoreContext";
import { useCellCountStoreContext } from "../../context/CellCountStoreContext";
import { useAnnotationSelectContext } from "../../context/AnnotationSelectContext";
import { useRulerContext } from "../../context/RulerContext";
import { useMessagingContext } from "../../context/MessagingContext";
import { useDialogContext } from "../../context/DialogContext";
import { moveWarnings, type MoveState } from "./moving";

// Stands between the viewer and a change of slide - from the gallery, an
// invite, a message or back and forward. With nothing to lose it just goes.
// Otherwise it says what would go and lets you stay. Either way, anything
// that only meant something on the old slide is let go of before it changes,
// so nothing is left pointing at it.
function MoveGuard() {
	const { setMoveGuard } = useImageViewerContext();
	const { pending, setPending, activeTool, setActiveTool } = useDrawContext();
	const { counting, pending: countPending, cancelCounting, setPending: setCountPending } = useCellCountDrawContext();
	const { stage: comparisonStage, quit, closeResults } = useComparisonContext();
	const { stage: sharedStage, leave } = useSharedCountContext();
	const { session, roomId } = useCollectionContext();
	const { setSelectedAnnotationId, setViewedAnnotationId } = useAnnotationStoreContext();
	const { setViewedCellCountId } = useCellCountStoreContext();
	const { clear: clearSelection } = useAnnotationSelectContext();
	const { clearMeasurement } = useRulerContext();
	const { showArea } = useMessagingContext();
	const { showDialog } = useDialogContext();

	// Read when a move is asked for, not when the guard was set.
	const now = {
		pending,
		activeTool,
		counting,
		countPending,
		comparisonStage,
		sharedStage,
		sessionName: roomId ? (session?.collectionName ?? "the session") : null,
	};
	const nowRef = useRef(now);
	const actionsRef = useRef({
		setPending,
		setActiveTool,
		cancelCounting,
		setCountPending,
		quit,
		closeResults,
		leave,
		setSelectedAnnotationId,
		setViewedAnnotationId,
		setViewedCellCountId,
		clearSelection,
		clearMeasurement,
		showArea,
		showDialog,
	});
	useEffect(() => {
		nowRef.current = now;
		actionsRef.current = {
			setPending,
			setActiveTool,
			cancelCounting,
			setCountPending,
			quit,
			closeResults,
			leave,
			setSelectedAnnotationId,
			setViewedAnnotationId,
			setViewedCellCountId,
			clearSelection,
			clearMeasurement,
			showArea,
			showDialog,
		};
	});

	useEffect(() => {
		const letGo = () => {
			const state = nowRef.current;
			const act = actionsRef.current;
			if (state.comparisonStage === "results") act.closeResults(false);
			else if (state.comparisonStage) act.quit();
			if (state.sharedStage) act.leave();
			if (state.counting) act.cancelCounting();
			act.setCountPending(null);
			act.setPending(null);
			act.setActiveTool(null);
			act.setSelectedAnnotationId(null);
			act.setViewedAnnotationId(null);
			act.setViewedCellCountId(null);
			act.clearSelection();
			act.clearMeasurement();
			act.showArea(null);
		};

		setMoveGuard(
			(slideId) =>
				new Promise<boolean>((resolve) => {
					const state = nowRef.current;
					const moveState: MoveState = {
						drawing: !!state.pending,
						counting: state.counting || !!state.countPending,
						comparison: !!state.comparisonStage,
						sharedCount: !!state.sharedStage,
						sessionName: state.sessionName,
					};
					const warnings = moveWarnings(moveState);
					if (warnings.length === 0) {
						letGo();
						resolve(true);
						return;
					}
					actionsRef.current.showDialog({
						title: `Go to slide ${slideId}?`,
						message: warnings.join(" "),
						// Escape runs the last one, so that's staying.
						actions: [
							{
								label: "Go to it",
								variant: "accent",
								onClick: () => {
									letGo();
									resolve(true);
								},
							},
							{ label: "Stay here", onClick: () => resolve(false) },
						],
					});
				}),
		);
		return () => setMoveGuard(null);
	}, [setMoveGuard]);

	return null;
}

export default MoveGuard;
