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
	created: string;
	// Who saved it - set by annotation-store from their token. Missing on
	// anything saved before sign-in.
	createdById?: string;
	createdByName?: string;
}

export type { Annotation };
