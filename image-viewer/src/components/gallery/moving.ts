// What you'd lose by going to another slide right now.
interface MoveState {
	// An annotation drawn but not saved yet.
	drawing: boolean;
	// A cell count that's running, or finished and not saved.
	counting: boolean;
	comparison: boolean;
	sharedCount: boolean;
	// The live session you're in the room of, if any.
	sessionName: string | null;
}

// One line each, in the order they'd matter. Empty means nothing's lost, so
// the move just happens.
function moveWarnings(state: MoveState): string[] {
	const warnings: string[] = [];
	if (state.drawing) warnings.push("The annotation you've drawn but not saved is thrown away.");
	if (state.comparison) warnings.push("You leave the comparison count.");
	else if (state.sharedCount) warnings.push("You leave the shared count.");
	else if (state.counting) warnings.push("The cell count you haven't saved is thrown away.");
	if (state.sessionName) warnings.push(`You leave ${state.sessionName} for now. You're still in it, and can go back in from its slide.`);
	return warnings;
}

export { moveWarnings };
export type { MoveState };
