import type { ShapeTool, LineStyleName } from "../components/annotation/Tools";

interface Annotation {
	id: string;
	label: string;
	notes: string;
	colour: string;
	shape: ShapeTool;
	lineStyle: LineStyleName;
	lineThickness: number;
	geoJson: string;
	// The AnnotationGroup it's in, if any. Missing on anything from before groups.
	groupId?: string | null;
	created: string;
	// Who saved it - set by annotation-store from their token. Missing on
	// anything saved before sign-in.
	createdById?: string;
	createdByName?: string;
	// The slices of a volume it's on, inclusive, from 0 - a 3D marker (see
	// components/depth/markers.ts). Missing or null is every slice, which is
	// every 2D annotation.
	sliceFrom?: number | null;
	sliceTo?: number | null;
}

export type { Annotation };
