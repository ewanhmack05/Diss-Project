import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { clampSlice, FLAT, isVolume, type Slice } from "../components/depth/slices";
import type { CutAxis } from "../components/depth/volume";
import { useEmitEvent } from "./EventContext";

type DepthView = "2d" | "3d";

// How the 3D view draws the block.
interface VolumeSettings {
	cut: CutAxis;
	// How far through the block the cut is, 0-1.
	cutPosition: number;
	// 0-1: how solid the tissue is. Lower to see into it.
	opacity: number;
	// Times the default depth (see defaultStretch in volume.ts).
	stretch: number;
	// As thick as the sections really are instead - see depthStretch.
	trueDepth: boolean;
	// The gap between slices against a slice's thickness - 0 is a solid block
	// (see slabAt in volume.ts).
	spacing: number;
	// Which slices are drawn, inclusive - fewer is a thinner block.
	firstSlice: number;
	lastSlice: number;
	// Outline and floor grid.
	guides: boolean;
}

const DEFAULT_SETTINGS: Omit<VolumeSettings, "firstSlice" | "lastSlice"> = {
	cut: "none",
	cutPosition: 0.5,
	opacity: 1,
	stretch: 1,
	trueDepth: false,
	spacing: 0,
	guides: true,
};

interface SliceContextValue {
	// The open slide's slices - one for a flat slide.
	slices: Slice[];
	// The one it opens on, and comes back to.
	defaultSlice: number;
	// The one showing.
	current: number;
	volume: boolean;
	// How thick the sections were cut, if the volume says. Null means the 3D
	// view assumes (see ASSUMED_SECTION_MICRONS).
	sectionMicrons: number | null;
	// Called by the map once a slide's loaded. Opens it on its default slice, in 2D.
	setSlices: (slices: Slice[], defaultSlice: number, slideId: string, sectionMicrons?: number | null) => void;
	// Clamped to the slices there are.
	showSlice: (slice: number) => void;
	step: (delta: number) => void;
	view: DepthView;
	setView: (view: DepthView) => void;
	settings: VolumeSettings;
	changeSettings: (change: Partial<VolumeSettings>) => void;
	// Bumped to put the 3D camera back where it started.
	cameraReset: number;
	resetCamera: () => void;
	// Somewhere for the 2D map to go - set by a click in 3D. id changes each
	// time, so the same place twice still moves it. Slide pixels, y down.
	lookAt: { x: number; y: number; id: number } | null;
	// A click in the 3D view: that slice, that place, in 2D.
	openInTwoD: (slice: number, x: number, y: number) => void;
}

const SliceContext = createContext<SliceContextValue | null>(null);

function allSlices(count: number): Pick<VolumeSettings, "firstSlice" | "lastSlice"> {
	return { firstSlice: 0, lastSlice: Math.max(0, count - 1) };
}

// Which slice of a volume is showing, and whether it's shown flat or as a
// block. Kept apart from the map so the Depth tab, the toolbar, the keyboard
// and the 3D view can all move it, and so it can later go out live with the
// viewport.
function SliceContextProvider({ children }: { children: ReactNode }) {
	const emit = useEmitEvent();
	const [slices, setSlicesState] = useState<Slice[]>(FLAT);
	const [defaultSlice, setDefaultSlice] = useState(0);
	const [current, setCurrent] = useState(0);
	const [sectionMicrons, setSectionMicrons] = useState<number | null>(null);
	const [view, setViewState] = useState<DepthView>("2d");
	const [settings, setSettings] = useState<VolumeSettings>({ ...DEFAULT_SETTINGS, ...allSlices(1) });
	const [cameraReset, setCameraReset] = useState(0);
	const [lookAt, setLookAt] = useState<{ x: number; y: number; id: number } | null>(null);
	// Read by step and showSlice, which shouldn't change identity with every
	// move. Only these setters change slice state, and they keep it up to date.
	const stateRef = useRef<{ slices: Slice[]; current: number; slideId: string }>({ slices: FLAT, current: 0, slideId: "" });

	const setSlices = useCallback((next: Slice[], nextDefault: number, slideId: string, thickness: number | null = null) => {
		stateRef.current = { slices: next, current: nextDefault, slideId };
		setSlicesState(next);
		setDefaultSlice(nextDefault);
		setCurrent(nextDefault);
		setSectionMicrons(thickness);
		// A new slide starts flat, with the whole block and no cut.
		setViewState("2d");
		setSettings({ ...DEFAULT_SETTINGS, ...allSlices(next.length) });
		setLookAt(null);
	}, []);

	const showSlice = useCallback(
		(slice: number) => {
			const { slices: known, current: from, slideId } = stateRef.current;
			const next = clampSlice(slice, known.length);
			if (next === from) return;
			stateRef.current = { ...stateRef.current, current: next };
			setCurrent(next);
			emit("slice:changed", { slideId, slice: next, from });
		},
		[emit],
	);

	const step = useCallback((delta: number) => showSlice(stateRef.current.current + delta), [showSlice]);

	const setView = useCallback(
		(next: DepthView) => {
			setViewState(next);
			emit("depth:view", { slideId: stateRef.current.slideId, view: next });
		},
		[emit],
	);

	const changeSettings = useCallback((change: Partial<VolumeSettings>) => setSettings((now) => ({ ...now, ...change })), []);
	const resetCamera = useCallback(() => setCameraReset((count) => count + 1), []);

	const openInTwoD = useCallback(
		(slice: number, x: number, y: number) => {
			showSlice(slice);
			setLookAt((now) => ({ x, y, id: (now?.id ?? 0) + 1 }));
			setView("2d");
		},
		[showSlice, setView],
	);

	const value = useMemo(
		() => ({
			slices,
			defaultSlice,
			current,
			volume: isVolume(slices),
			sectionMicrons,
			setSlices,
			showSlice,
			step,
			view,
			setView,
			settings,
			changeSettings,
			cameraReset,
			resetCamera,
			lookAt,
			openInTwoD,
		}),
		[slices, defaultSlice, current, sectionMicrons, setSlices, showSlice, step, view, setView, settings, changeSettings, cameraReset, resetCamera, lookAt, openInTwoD],
	);
	return <SliceContext.Provider value={value}>{children}</SliceContext.Provider>;
}

function useSliceContext(): SliceContextValue {
	const context = useContext(SliceContext);
	if (!context) {
		throw new Error("useSliceContext must be used within a SliceContextProvider");
	}
	return context;
}

export { SliceContextProvider, useSliceContext };
export type { DepthView, VolumeSettings };
