import { useMemo } from "react";
import { useAnnotationStoreContext } from "../../../context/AnnotationStoreContext";
import { useLayersContext } from "../../../context/LayersContext";
import { matchesSearch, passes } from "../../saved/filters";
import { tally, type Tally } from "./layers";

// How many of the collection's annotations are on the map, and why the rest
// aren't - the On the map tab's line and the Collections button's dot both
// read this, so they can't disagree.
function useMapTally(): Tally {
	const { annotations, mapFilter } = useAnnotationStoreContext();
	const { hidden } = useLayersContext();
	return useMemo(
		() =>
			tally(
				annotations,
				hidden,
				mapFilter ? (annotation) => passes(annotation, mapFilter.filters) && matchesSearch(annotation, mapFilter.search) : undefined,
			),
		[annotations, hidden, mapFilter],
	);
}

export { useMapTally };
