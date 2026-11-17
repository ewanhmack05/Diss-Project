// Global shortcuts (like F for fullscreen, or PageDown for the next slice)
// shouldn't fire while the user is typing somewhere - e.g. "f" in an
// annotation's label or notes field.
const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isTypingTarget(target: EventTarget | null): boolean {
	if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
	return TYPING_TAGS.has(target.tagName) || target.isContentEditable;
}

export { isTypingTarget };
