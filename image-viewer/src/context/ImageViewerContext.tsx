import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ImageSource } from "../interfaces/ImageSource";
import { searchWithSlide, slideFromSearch } from "../components/gallery/slideUrl";
import { useEmitEvent } from "./EventContext";

// Asked before the slide changes. Resolves false to stay where you are -
// see components/gallery/MoveGuard.
type MoveGuard = (slideId: string) => Promise<boolean>;

interface ImageViewerContextValue {
	// Only a new object when the slide changes, so nothing that depends on it
	// runs again for any other reason.
	source: ImageSource;
	// The slide the viewer was given to start on (App's source).
	startSlideId: string;
	// Goes to another slide, once the guard says it's fine. Resolves whether
	// it did.
	moveToSlide: (slideId: string) => Promise<boolean>;
	// Only one at a time - null takes it away.
	setMoveGuard: (guard: MoveGuard | null) => void;
}

const ImageViewerContext = createContext<ImageViewerContextValue | null>(null);

interface ImageViewerContextProviderProps {
	tilerUrl: string;
	startSlideId: string;
	children: ReactNode;
}

function slideInAddress(startSlideId: string): string {
	return slideFromSearch(window.location.search) ?? startSlideId;
}

function addressFor(slideId: string, startSlideId: string): string {
	const { pathname, search, hash } = window.location;
	return pathname + searchWithSlide(search, slideId, startSlideId) + hash;
}

// Which slide is open. It starts on the one the viewer was given unless the
// address says another (?slide=), and the address follows it from then on,
// so back and forward move between slides and a copied link opens the same one.
function ImageViewerContextProvider({ tilerUrl, startSlideId, children }: ImageViewerContextProviderProps) {
	const emit = useEmitEvent();
	const [slideId, setSlideId] = useState(() => slideInAddress(startSlideId));
	const slideIdRef = useRef(slideId);
	const guardRef = useRef<MoveGuard | null>(null);

	const show = useCallback(
		(next: string) => {
			const from = slideIdRef.current;
			if (next === from) return;
			slideIdRef.current = next;
			setSlideId(next);
			emit("slide:changed", { slideId: next, from });
		},
		[emit],
	);

	const allowed = useCallback(async (next: string) => {
		const guard = guardRef.current;
		if (!guard) return true;
		try {
			return await guard(next);
		} catch {
			return false;
		}
	}, []);

	const moveToSlide = useCallback(
		async (next: string) => {
			if (next === slideIdRef.current) return true;
			if (!(await allowed(next))) return false;
			window.history.pushState(window.history.state, "", addressFor(next, startSlideId));
			show(next);
			return true;
		},
		[allowed, show, startSlideId],
	);

	// Back and forward have already changed the address by the time this
	// hears of it, so saying no puts the slide you're on back in it.
	useEffect(() => {
		const follow = async () => {
			const next = slideInAddress(startSlideId);
			if (next === slideIdRef.current) return;
			if (await allowed(next)) show(next);
			else window.history.pushState(window.history.state, "", addressFor(slideIdRef.current, startSlideId));
		};
		follow();
		window.addEventListener("popstate", follow);
		return () => window.removeEventListener("popstate", follow);
	}, [allowed, show, startSlideId]);

	const setMoveGuard = useCallback((guard: MoveGuard | null) => {
		guardRef.current = guard;
	}, []);

	const source = useMemo<ImageSource>(() => ({ tilerUrl, slideId }), [tilerUrl, slideId]);
	const value = useMemo(() => ({ source, startSlideId, moveToSlide, setMoveGuard }), [source, startSlideId, moveToSlide, setMoveGuard]);

	return <ImageViewerContext.Provider value={value}>{children}</ImageViewerContext.Provider>;
}

function useImageViewerContext(): ImageViewerContextValue {
	const context = useContext(ImageViewerContext);
	if (!context) {
		throw new Error("useImageViewerContext must be used within an ImageViewerContextProvider");
	}
	return context;
}

export { ImageViewerContextProvider, useImageViewerContext };
export type { MoveGuard };
