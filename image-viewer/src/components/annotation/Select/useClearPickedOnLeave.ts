import { useEffect, useRef } from "react";
import { useAnnotationSelectContext } from "../../../context/AnnotationSelectContext";
import { useCollectionContext } from "../../../context/CollectionContext";
import { useToolbarContext } from "../../../context/ToolbarContext";

// Nothing stays picked once you leave the Select tab - closing the
// Annotations panel, moving to another tab, or losing edit.
//
// Watched from the viewer shell, which is always there, rather than cleared
// when the tab unmounts: React mounts things twice in development, and a group
// page's "Select on map" picks before opening the tab, so an unmount clear
// would throw that pick away as the tab appears.
function useClearPickedOnLeave(): void {
	const { activeTools, panelTabs } = useToolbarContext();
	const { canEdit } = useCollectionContext();
	const { clear } = useAnnotationSelectContext();
	const onSelect = activeTools.includes("annotations") && panelTabs.annotations === "select" && canEdit;
	const was = useRef(onSelect);
	useEffect(() => {
		if (was.current && !onSelect) clear();
		was.current = onSelect;
	}, [onSelect, clear]);
}

export { useClearPickedOnLeave };
