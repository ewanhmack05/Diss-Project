// The area (if any) the bot is allowed to place things within, in the same
// normalized [0,1] image-space (top-left origin, y-down) seed.json's own
// neuron x/y already use - see payloads.ts's projectToMapCoordinates, which
// is what actually reads this.
interface NormalizedRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface BotControlState {
	annotationsEnabled: boolean;
	cellCountEnabled: boolean;
	// pathway ticks are never gated by these two flags - they're what drives
	// the live 3D connectome view, independent of whether the 2D slide
	// overlay's annotations/cell counts are currently switched on.
	region: NormalizedRegion | null;
	// Which slide image-viewer currently has open, reported by
	// BotControlContext on load and on every slide change (see
	// resolveActiveSlideId below and bot.ts's ensureCurrentSlide, which is
	// what actually reacts to this) - null until a browser has reported one,
	// in which case the bot falls back to its own BOT_SLIDE_ID default.
	slideId: string | null;
}

function defaultControlState(initialSlideId: string | null = null): BotControlState {
	return { annotationsEnabled: true, cellCountEnabled: true, region: null, slideId: initialSlideId };
}

// Never null in practice once any browser has reported in (see
// BotControlContext's slideId-reporting effect), but bot.ts always has its
// own BOT_SLIDE_ID default to fall back to before that first report arrives.
function resolveActiveSlideId(control: BotControlState, fallbackSlideId: string): string {
	return control.slideId ?? fallbackSlideId;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

// Clamps rather than rejects a slightly-out-of-range region (e.g. a drawn
// box whose edge lands at 1.0000000002 from floating-point rounding) - only
// genuinely malformed input (missing/non-numeric fields, a real object
// where region should be) is treated as an error. Returns null for a
// perfectly reasonable "clear the region" request.
function normalizeRegion(value: unknown): NormalizedRegion | null | undefined {
	if (value === null) return null;
	if (typeof value !== 'object') return undefined;
	const candidate = value as Record<string, unknown>;
	if (![candidate.x, candidate.y, candidate.width, candidate.height].every(isFiniteNumber)) return undefined;

	const x = Math.min(Math.max(candidate.x as number, 0), 1);
	const y = Math.min(Math.max(candidate.y as number, 0), 1);
	const width = Math.min(Math.max(candidate.width as number, 0), 1 - x);
	const height = Math.min(Math.max(candidate.height as number, 0), 1 - y);
	if (width <= 0 || height <= 0) return undefined;

	return { x, y, width, height };
}

// A patch, not a full replacement - a POST only naming `region` leaves
// annotationsEnabled/cellCountEnabled exactly as they were, and vice versa,
// so the panel's three independent controls (two toggles, one region) never
// have to know or resend each other's current value. Returns null for a
// patch that couldn't be applied at all (malformed JSON shape), so the HTTP
// layer can 400 rather than silently keep stale state.
function applyControlPatch(current: BotControlState, patch: unknown): BotControlState | null {
	if (typeof patch !== 'object' || patch === null) return null;
	const body = patch as Record<string, unknown>;
	const next: BotControlState = { ...current };

	if ('annotationsEnabled' in body) {
		if (typeof body.annotationsEnabled !== 'boolean') return null;
		next.annotationsEnabled = body.annotationsEnabled;
	}
	if ('cellCountEnabled' in body) {
		if (typeof body.cellCountEnabled !== 'boolean') return null;
		next.cellCountEnabled = body.cellCountEnabled;
	}
	if ('region' in body) {
		const region = normalizeRegion(body.region);
		if (region === undefined) return null;
		next.region = region;
	}
	// No null-clearing convention here like region's - a browser reporting in
	// always knows a concrete slide it has open, so an empty/non-string value
	// is just a malformed patch, not "go back to no slide".
	if ('slideId' in body) {
		if (typeof body.slideId !== 'string' || body.slideId.length === 0) return null;
		next.slideId = body.slideId;
	}

	return next;
}

export { defaultControlState, applyControlPatch, normalizeRegion, resolveActiveSlideId };
export type { BotControlState, NormalizedRegion };
