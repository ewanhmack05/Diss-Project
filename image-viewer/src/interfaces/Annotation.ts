import type { ShapeTool, LineStyleName } from "../components/annotation/Tools";

interface Annotation {
	id: string;
	label: string;
	colour: string;
	shape: ShapeTool;
	lineStyle: LineStyleName;
	lineThickness: number;
	geoJson: string;
	created: string;
}

export type { Annotation };
