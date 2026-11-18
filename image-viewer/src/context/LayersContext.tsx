import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { NONE_HIDDEN, type Hidden } from "../components/collections/map/layers";
import { useCollectionContext } from "./CollectionContext";

type Row = keyof Hidden;

interface LayersContextValue {
	// The On the map tab's chips that are off - people and groups whose
	// annotations are left off the map. Yours alone, never sent anywhere,
	// and back to all on when you move collection.
	hidden: Hidden;
	toggle: (row: Row, key: string) => void;
	// A whole row at once - "only this one", or putting it back. Give it a
	// function of the row as it is to build on the latest, not on what the
	// last render saw - a double-click arrives straight after two clicks.
	setRow: (row: Row, keys: ReadonlySet<string> | ((current: ReadonlySet<string>) => ReadonlySet<string>)) => void;
	showAll: () => void;
}

const LayersContext = createContext<LayersContextValue | null>(null);

function LayersContextProvider({ children }: { children: ReactNode }) {
	const { collectionId } = useCollectionContext();
	// Moving collection puts everything back on - they were the old one's
	// people and groups, and coming back later starts fresh too. Reset while
	// rendering, so no render shows the old ones off (React's way of resetting
	// state when a value changes).
	const [state, setState] = useState<{ collectionId: string | null; hidden: Hidden }>({ collectionId, hidden: NONE_HIDDEN });
	if (state.collectionId !== collectionId) setState({ collectionId, hidden: NONE_HIDDEN });
	const hidden = state.collectionId === collectionId ? state.hidden : NONE_HIDDEN;

	const update = useCallback(
		(change: (current: Hidden) => Hidden) =>
			setState((current) => {
				const from = current.collectionId === collectionId ? current.hidden : NONE_HIDDEN;
				return { collectionId, hidden: change(from) };
			}),
		[collectionId],
	);
	const toggle = useCallback(
		(row: Row, key: string) =>
			update((current) => {
				const next = new Set(current[row]);
				if (!next.delete(key)) next.add(key);
				return { ...current, [row]: next };
			}),
		[update],
	);
	const setRow = useCallback(
		(row: Row, keys: ReadonlySet<string> | ((current: ReadonlySet<string>) => ReadonlySet<string>)) =>
			update((current) => ({ ...current, [row]: new Set(typeof keys === "function" ? keys(current[row]) : keys) })),
		[update],
	);
	const showAll = useCallback(() => update(() => NONE_HIDDEN), [update]);

	const value = useMemo(() => ({ hidden, toggle, setRow, showAll }), [hidden, toggle, setRow, showAll]);
	return <LayersContext.Provider value={value}>{children}</LayersContext.Provider>;
}

function useLayersContext(): LayersContextValue {
	const context = useContext(LayersContext);
	if (!context) {
		throw new Error("useLayersContext must be used within a LayersContextProvider");
	}
	return context;
}

export { LayersContextProvider, useLayersContext };
