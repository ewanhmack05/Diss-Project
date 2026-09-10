import { Circle as CircleStyle, Fill, RegularShape, Stroke, Style } from "ol/style";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import type Geometry from "ol/geom/Geometry";
import type { FeatureLike } from "ol/Feature";
import type { LineStyleName, ShapeTool } from "../annotation/Tools";

function lineDashFor(lineStyle: LineStyleName, lineThickness: number): number[] | undefined {
	return lineStyle === "dashed" ? [lineThickness * 3, lineThickness * 2] : undefined;
}

function baseStyle(colour: string, lineThickness: number, lineStyle: LineStyleName): Style {
	return new Style({
		stroke: new Stroke({
			color: colour,
			width: lineThickness,
			lineDash: lineDashFor(lineStyle, lineThickness),
		}),
		fill: new Fill({ color: `${colour}33` }),
		image: new CircleStyle({ radius: 5, fill: new Fill({ color: colour }) }),
	});
}

function arrowHeadStyle(colour: string, lineThickness: number, line: LineString): Style | null {
	const coords = line.getCoordinates();
	if (coords.length < 2) return null;
	const [x1, y1] = coords[coords.length - 2];
	const [x2, y2] = coords[coords.length - 1];
	const angle = Math.atan2(y2 - y1, x2 - x1);
	return new Style({
		geometry: new Point([x2, y2]),
		image: new RegularShape({
			points: 3,
			radius: 6 + lineThickness * 1.5,
			angle: Math.PI / 2,
			rotation: -angle,
			fill: new Fill({ color: colour }),
		}),
	});
}

function withArrowHead(
	styles: Style[],
	shape: ShapeTool | undefined,
	colour: string,
	lineThickness: number,
	geometry: Geometry | undefined,
): Style[] {
	if (shape === "arrow" && geometry instanceof LineString) {
		const arrow = arrowHeadStyle(colour, lineThickness, geometry);
		if (arrow) styles.push(arrow);
	}
	return styles;
}

// Live in-progress sketch style - a function (not a constant Style) so the
// arrowhead tracks the line's current endpoint on every pointer move, not
// just once drawend fires.
function sketchStyle(shape: ShapeTool, colour: string, lineThickness: number, lineStyle: LineStyleName) {
	return (feature: FeatureLike): Style[] =>
		withArrowHead([baseStyle(colour, lineThickness, lineStyle)], shape, colour, lineThickness, feature.getGeometry() as Geometry | undefined);
}

// Finished features (both the just-drawn pending one and saved ones) carry
// colour/lineThickness/lineStyle/shape as feature properties.
function annotationStyle(feature: FeatureLike): Style[] {
	const colour = (feature.get("colour") as string | undefined) ?? "#fff614";
	const lineThickness = (feature.get("lineThickness") as number | undefined) ?? 2;
	const lineStyle = (feature.get("lineStyle") as LineStyleName | undefined) ?? "solid";
	const shape = feature.get("shape") as ShapeTool | undefined;

	return withArrowHead([baseStyle(colour, lineThickness, lineStyle)], shape, colour, lineThickness, feature.getGeometry() as Geometry | undefined);
}

export { annotationStyle, sketchStyle };
