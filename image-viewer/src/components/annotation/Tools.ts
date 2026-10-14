import { createBox, createRegularPolygon } from "ol/interaction/Draw";
import type { Options as DrawOptions } from "ol/interaction/Draw";

type ShapeTool = "line" | "freehand" | "polygon" | "arrow" | "rectangle" | "circle";
type LineStyleName = "solid" | "dashed";

interface ShapeToolConfig {
	label: string;
	drawType: "LineString" | "Polygon" | "Circle";
	freehand?: boolean;
	maxPoints?: number;
	geometryFunction?: DrawOptions["geometryFunction"];
}

const ShapeTools: Record<ShapeTool, ShapeToolConfig> = {
	line: { label: "Line", drawType: "LineString", maxPoints: 2 },
	arrow: { label: "Arrow", drawType: "LineString", maxPoints: 2 },
	freehand: { label: "Freehand", drawType: "LineString", freehand: true },
	polygon: { label: "Polygon", drawType: "Polygon" },
	rectangle: { label: "Rectangle", drawType: "Circle", geometryFunction: createBox() },
	circle: { label: "Circle", drawType: "Circle", geometryFunction: createRegularPolygon(50, 0) },
};

const ShapeOrder: ShapeTool[] = ["line", "freehand", "polygon", "arrow", "rectangle", "circle"];

// Same fixed palette as their ColourSelection (Tools.ts PreDefinedColours).
const PreDefinedColours = ["#FB0909", "#0913FB", "#FB09FB", "#000000", "#168304", "#06EAF9", "#F9E006", "#FFFFFF"];

// What a new shape or cell-count dot starts in - the palette's yellow, so
// it shows as a swatch rather than Custom (and filters as yellow).
const DefaultColour = "#F9E006";

const LineThicknessOptions = [1, 2, 3, 4, 5, 6];

export { ShapeTools, ShapeOrder, PreDefinedColours, DefaultColour, LineThicknessOptions };
export type { ShapeTool, LineStyleName, ShapeToolConfig };
