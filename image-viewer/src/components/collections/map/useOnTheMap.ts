import { useCallback } from "react";
import { useAnnotationStoreContext, type MapFilter } from "../../../context/AnnotationStoreContext";
import { useLayersContext } from "../../../context/LayersContext";
import type { Annotation } from "../../../interfaces/Annotation";
import { matchesSearch, passes, type Filterable } from "../../saved/filters";
import { onTheMap } from "./layers";

// The open Saved list's search and filters as one check, or undefined when
// it isn't narrowing the map.
function savedCheck<T extends Filterable>(mapFilter: MapFilter | null): ((annotation: T) => boolean) | undefined {
	if (!mapFilter) return undefined;
	return (annotation) => passes(annotation, mapFilter.filters) && matchesSearch(annotation, mapFilter.search);
}

// Whether an annotation's on the map right now. The 2D map and the 3D block
// both draw from this, so a marker can't be off one and still on the other.
function useOnTheMap(): (annotation: Annotation) => boolean {
	const { mapFilter } = useAnnotationStoreContext();
	const { hidden } = useLayersContext();
	return useCallback((annotation: Annotation) => onTheMap(annotation, hidden, savedCheck(mapFilter)), [hidden, mapFilter]);
}

export { savedCheck, useOnTheMap };
