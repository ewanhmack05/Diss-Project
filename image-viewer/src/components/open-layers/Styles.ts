import { Circle as CircleStyle, Fill, RegularShape, Stroke, Style } from "ol/style";
import LineString from "ol/geom/LineString";
import Polygon from "ol/geom/Polygon";
import Point from "ol/geom/Point";
import type Geometry from "ol/geom/Geometry";
import type { FeatureLike } from "ol/Feature";
import type { LineStyleName, ShapeTool } from "../annotation/Tools";

// The slide's own coarsest view resolution (map units - i.e. native slide
// pixels - per screen pixel at the most zoomed-out the view ever goes) -
// set once per slide by MapNode right after the map is built (see
// setStyleReferenceResolution), never touched again as the user zooms.
// A shape's length in native slide pixels alone is a bad proxy for "does
// this look short" - a slide's native size is tens of thousands of pixels,
// so even a short-looking drag made while zoomed out covers thousands of
// them (each screen pixel spans many native ones at low zoom), which made
// an earlier version of the arrowhead cap below effectively never engage
// for exactly the zoomed-out case it was meant to fix. Dividing by this
// constant instead expresses length as "how many screen pixels this would
// span if the view were fully zoomed out" - small, intuitive numbers,
// normalized for the slide's own size, and still completely fixed once an
// annotation is drawn (this constant doesn't change with the *current*
// zoom, only with which slide is loaded), so it doesn't reintroduce any
// scroll-dependence. Used by both the arrowhead cap and the dash-pattern
// cap below, for the same reason in both places.
let coarsestResolution = 1;

function setStyleReferenceResolution(resolution: number): void {
	coarsestResolution = resolution;
}

// Sum of consecutive-point distances - LinearRing has no built-in
// getLength() (only getArea()), unlike LineString.
function ringPerimeter(coords: number[][]): number {
	let total = 0;
	for (let i = 1; i < coords.length; i++) {
		const [x1, y1] = coords[i - 1];
		const [x2, y2] = coords[i];
		total += Math.hypot(x2 - x1, y2 - y1);
	}
	return total;
}

// A LineString's total length, or a Polygon's perimeter (its outer ring's
// length) - whichever a shape actually has - in the same coarsest-view-
// normalized units as coarsestResolution above. 0 for anything else (a
// shape too small/degenerate to have a meaningful length, e.g. a point).
function geometryLength(geometry: Geometry | undefined): number {
	if (geometry instanceof LineString) return geometry.getLength() / coarsestResolution;
	if (geometry instanceof Polygon) {
		const ring = geometry.getLinearRing(0);
		return ring ? ringPerimeter(ring.getCoordinates()) / coarsestResolution : 0;
	}
	return 0;
}

// Ensures at least this many dash+gap cycles fit along even a short dashed
// shape, rather than one oversized dash barely fitting on it - mirrors
// arrowHeadRadius's reasoning below. effectiveLength must already be in
// coarsest-view-normalized units (see coarsestResolution/geometryLength
// above), not raw map units.
const DASH_MIN_REPEATS = 3;

// The dash/gap lengths at full size - unchanged from before, just pulled
// out so the cap can be expressed in terms of them.
function maxDashPattern(lineThickness: number): [dash: number, gap: number] {
	return [lineThickness * 3, lineThickness * 2];
}

function dashPattern(lineThickness: number, effectiveLength: number): number[] {
	const [maxDash, maxGap] = maxDashPattern(lineThickness);
	const maxPeriod = maxDash + maxGap;
	const period = Math.min(maxPeriod, effectiveLength / DASH_MIN_REPEATS);
	return [period * (maxDash / maxPeriod), period * (maxGap / maxPeriod)];
}

function lineDashFor(lineStyle: LineStyleName, lineThickness: number, effectiveLength: number): number[] | undefined {
	return lineStyle === "dashed" ? dashPattern(lineThickness, effectiveLength) : undefined;
}

function baseStyle(colour: string, lineThickness: number, lineStyle: LineStyleName, geometry: Geometry | undefined): Style {
	return new Style({
		stroke: new Stroke({
			color: colour,
			width: lineThickness,
			lineDash: lineDashFor(lineStyle, lineThickness, geometryLength(geometry)),
		}),
		fill: new Fill({ color: `${colour}33` }),
		image: new CircleStyle({ radius: 5, fill: new Fill({ color: colour }) }),
	});
}

// Below this length (in coarsest-view screen pixels - see
// coarsestResolution above) the head shrinks proportionally rather than
// dwarfing its own shaft; at or above it, the head is simply the fixed
// size it always was.
const ARROWHEAD_LENGTH_RATIO = 9 / 40;

// The head's un-capped size - unchanged from before, just pulled out so the
// cap can be expressed in terms of it.
function arrowHeadMaxRadius(lineThickness: number): number {
	return 6 + lineThickness * 1.5;
}

// segmentLength must already be in coarsest-view screen-pixel terms (see
// coarsestResolution above), not raw map units - arrowHeadStyle does that
// conversion before calling this; kept as a separate, pure function so the
// cap arithmetic itself is unit-testable without mocking a LineString.
function arrowHeadRadius(lineThickness: number, segmentLength: number): number {
	return Math.min(arrowHeadMaxRadius(lineThickness), segmentLength * ARROWHEAD_LENGTH_RATIO);
}

function arrowHeadStyle(colour: string, lineThickness: number, line: LineString): Style | null {
	const coords = line.getCoordinates();
	if (coords.length < 2) return null;
	const [x1, y1] = coords[coords.length - 2];
	const [x2, y2] = coords[coords.length - 1];
	const angle = Math.atan2(y2 - y1, x2 - x1);
	const segmentLength = Math.hypot(x2 - x1, y2 - y1) / coarsestResolution;
	return new Style({
		geometry: new Point([x2, y2]),
		image: new RegularShape({
			points: 3,
			radius: arrowHeadRadius(lineThickness, segmentLength),
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
// arrowhead and dash pattern both track the shape's current extent on
// every pointer move, not just once drawend fires.
function sketchStyle(shape: ShapeTool, colour: string, lineThickness: number, lineStyle: LineStyleName) {
	return (feature: FeatureLike): Style[] => {
		const geometry = feature.getGeometry() as Geometry | undefined;
		return withArrowHead([baseStyle(colour, lineThickness, lineStyle, geometry)], shape, colour, lineThickness, geometry);
	};
}

// Finished features (both the just-drawn pending one and saved ones) carry
// colour/lineThickness/lineStyle/shape as feature properties.
function annotationStyle(feature: FeatureLike): Style[] {
	const colour = (feature.get("colour") as string | undefined) ?? "#fff614";
	const lineThickness = (feature.get("lineThickness") as number | undefined) ?? 2;
	const lineStyle = (feature.get("lineStyle") as LineStyleName | undefined) ?? "solid";
	const shape = feature.get("shape") as ShapeTool | undefined;
	const geometry = feature.getGeometry() as Geometry | undefined;

	return withArrowHead([baseStyle(colour, lineThickness, lineStyle, geometry)], shape, colour, lineThickness, geometry);
}

// One placed cell-count dot - colour/dotSize carried as feature properties,
// same convention as annotationStyle.
function cellCountDotStyle(feature: FeatureLike): Style {
	const colour = (feature.get("colour") as string | undefined) ?? "#fff614";
	const dotSize = (feature.get("dotSize") as number | undefined) ?? 6;
	return new Style({
		image: new CircleStyle({
			radius: dotSize,
			fill: new Fill({ color: colour }),
			stroke: new Stroke({ color: "#000", width: 1 }),
		}),
	});
}

const ROI_BOX_COLOUR = "#00e0ff";

// A fixed-size ROI box, draggable into place before counting starts (see
// MapNode) - just an outline/fill, no resize handles since it isn't
// resizable.
function roiBoxStyle(): Style {
	return new Style({
		stroke: new Stroke({ color: ROI_BOX_COLOUR, width: 2, lineDash: [6, 4] }),
		fill: new Fill({ color: `${ROI_BOX_COLOUR}1a` }),
	});
}

export {
	annotationStyle,
	sketchStyle,
	cellCountDotStyle,
	roiBoxStyle,
	arrowHeadRadius,
	dashPattern,
	setStyleReferenceResolution,
};
