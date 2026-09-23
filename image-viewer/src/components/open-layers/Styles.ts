import { Circle as CircleStyle, Fill, RegularShape, Stroke, Style, Text } from "ol/style";
import LineString from "ol/geom/LineString";
import Polygon from "ol/geom/Polygon";
import Point from "ol/geom/Point";
import type Geometry from "ol/geom/Geometry";
import type Feature from "ol/Feature";
import type { FeatureLike } from "ol/Feature";
import type { FlatStyle, Rule } from "ol/style/flat";
import { asArray } from "ol/color";
import { ShapeTools, type LineStyleName, type ShapeTool } from "../annotation/Tools";
import { pixelDistance, physicalDistanceMicrons, formatDistanceMicrons, formatDistancePixels } from "../ruler/ruler";

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
// length) - whichever a shape actually has - in map units. 0 for anything
// else (a shape too small/degenerate to have a meaningful length, e.g. a
// point).
function geometryLength(geometry: Geometry | undefined): number {
	if (geometry instanceof LineString) return geometry.getLength();
	if (geometry instanceof Polygon) {
		const ring = geometry.getLinearRing(0);
		return ring ? ringPerimeter(ring.getCoordinates()) : 0;
	}
	return 0;
}

// Ensures at least this many dash+gap cycles fit along even a short dashed
// shape, rather than one oversized dash barely fitting on it - mirrors
// arrowHeadRadius's reasoning below. effectiveLength is the shape's length
// on screen at the current zoom, in pixels - measuring it against the fully
// zoomed-out view instead made anything drawn zoomed in count as a few
// pixels long, so its dashes shrank until the line looked solid.
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

function baseStyle(
	colour: string,
	lineThickness: number,
	lineStyle: LineStyleName,
	geometry: Geometry | undefined,
	resolution: number,
): Style {
	return new Style({
		stroke: new Stroke({
			color: colour,
			width: lineThickness,
			lineDash: lineDashFor(lineStyle, lineThickness, geometryLength(geometry) / resolution),
		}),
		fill: new Fill({ color: `${colour}33` }),
		image: new CircleStyle({ radius: 5, fill: new Fill({ color: colour }) }),
	});
}

// Below this on-screen length the head shrinks proportionally rather than
// dwarfing its own shaft; at or above it, the head is simply the fixed
// size it always was.
const ARROWHEAD_LENGTH_RATIO = 9 / 40;

// The head's un-capped size - unchanged from before, just pulled out so the
// cap can be expressed in terms of it.
function arrowHeadMaxRadius(lineThickness: number): number {
	return 6 + lineThickness * 1.5;
}

// segmentLength must already be in screen pixels, not raw map units -
// arrowHeadStyle does that conversion before calling this; kept as a
// separate, pure function so the cap arithmetic itself is unit-testable
// without mocking a LineString.
function arrowHeadRadius(lineThickness: number, segmentLength: number): number {
	return Math.min(arrowHeadMaxRadius(lineThickness), segmentLength * ARROWHEAD_LENGTH_RATIO);
}

// Sized from the arrow's length on screen at the current zoom. Measuring it
// against the fully zoomed-out view instead meant an arrow drawn zoomed in
// counted as a few pixels long, so its head shrank to nothing.
function arrowHeadStyle(colour: string, lineThickness: number, line: LineString, resolution: number): Style | null {
	const coords = line.getCoordinates();
	if (coords.length < 2) return null;
	const [x1, y1] = coords[coords.length - 2];
	const [x2, y2] = coords[coords.length - 1];
	const angle = Math.atan2(y2 - y1, x2 - x1);
	const segmentLength = Math.hypot(x2 - x1, y2 - y1) / resolution;
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
	resolution: number,
): Style[] {
	if (shape === "arrow" && geometry instanceof LineString) {
		const arrow = arrowHeadStyle(colour, lineThickness, geometry, resolution);
		if (arrow) styles.push(arrow);
	}
	return styles;
}

// Live in-progress sketch style - a function (not a constant Style) so the
// arrowhead and dash pattern both track the shape's current extent on
// every pointer move, not just once drawend fires.
function sketchStyle(shape: ShapeTool, colour: string, lineThickness: number, lineStyle: LineStyleName) {
	// For polygon, rectangle and circle, Draw also adds a helper line tracing
	// the same outline. It's drawn the opposite way round to the polygon, so
	// with dashes on, each one's dashes filled the other's gaps and the
	// sketch looked solid - the polygon already shows every edge, so the
	// helper line is left unstyled.
	const hideSketchLine = ShapeTools[shape].drawType !== "LineString";
	return (feature: FeatureLike, resolution: number): Style[] => {
		const geometry = feature.getGeometry() as Geometry | undefined;
		if (hideSketchLine && geometry instanceof LineString) return [];
		return withArrowHead([baseStyle(colour, lineThickness, lineStyle, geometry, resolution)], shape, colour, lineThickness, geometry, resolution);
	};
}

// Finished features (both the just-drawn pending one and saved ones) carry
// colour/lineThickness/lineStyle/shape as feature properties.
function annotationStyle(feature: FeatureLike, resolution: number): Style[] {
	const colour = (feature.get("colour") as string | undefined) ?? "#fff614";
	const lineThickness = (feature.get("lineThickness") as number | undefined) ?? 2;
	const lineStyle = (feature.get("lineStyle") as LineStyleName | undefined) ?? "solid";
	const shape = feature.get("shape") as ShapeTool | undefined;
	const geometry = feature.getGeometry() as Geometry | undefined;

	return withArrowHead([baseStyle(colour, lineThickness, lineStyle, geometry, resolution)], shape, colour, lineThickness, geometry, resolution);
}

// Saved annotations render on the GPU (WebGLVectorLayer), which only takes
// flat styles - no style functions, so anything annotationStyle works out
// per render has to be baked onto the feature up front instead. Call this
// whenever a saved annotation's feature is built.
function setAnnotationRenderProperties(feature: Feature<Geometry>): void {
	const colour = (feature.get("colour") as string | undefined) ?? "#fff614";
	const lineThickness = (feature.get("lineThickness") as number | undefined) ?? 2;
	const lineStyle = (feature.get("lineStyle") as LineStyleName | undefined) ?? "solid";
	const [red, green, blue] = asArray(colour);
	feature.setProperties(
		{
			strokeColour: colour,
			strokeWidth: lineThickness,
			fillColour: [red, green, blue, 0.2],
			dashed: lineStyle === "dashed" ? 1 : 0,
			outlineLength: geometryLength(feature.getGeometry()),
		},
		true,
	);
}

const annotationFlatBase: FlatStyle = {
	"stroke-color": ["get", "strokeColour"],
	"stroke-width": ["get", "strokeWidth"],
	"fill-color": ["get", "fillColour"],
};

// dashPattern above, worked out on the GPU so it follows the current zoom:
// the dash+gap period is a third of the shape's on-screen length, capped at
// the full-size period (5x the line width). The lower bound just keeps a
// zero-length shape from dividing by zero in the shader.
const dashPeriod = ["clamp", ["/", ["/", ["get", "outlineLength"], ["resolution"]], DASH_MIN_REPEATS], 0.01, ["*", ["get", "strokeWidth"], 5]];

const annotationFlatStyle: Rule[] = [
	{
		filter: ["==", ["get", "dashed"], 1],
		style: {
			...annotationFlatBase,
			"stroke-line-dash": [
				["*", dashPeriod, 3 / 5],
				["*", dashPeriod, 2 / 5],
			],
		},
	},
	{ else: true, style: annotationFlatBase },
];

// WebGL layers can't draw a styled point at a line's end, so saved arrows
// get their heads from a small canvas layer on the same source - returns
// nothing for every other shape, so that layer has very little to draw.
function annotationArrowHeadStyle(feature: FeatureLike, resolution: number): Style | undefined {
	if (feature.get("shape") !== "arrow") return undefined;
	const geometry = feature.getGeometry();
	if (!(geometry instanceof LineString)) return undefined;
	const colour = (feature.get("colour") as string | undefined) ?? "#fff614";
	const lineThickness = (feature.get("lineThickness") as number | undefined) ?? 2;
	return arrowHeadStyle(colour, lineThickness, geometry, resolution) ?? undefined;
}

// GPU version of cellCountDotStyle below - same look, for the placed and
// viewed dot layers.
const cellCountDotFlatStyle: FlatStyle = {
	"circle-radius": ["get", "dotSize"],
	"circle-fill-color": ["get", "colour"],
	"circle-stroke-color": "#000",
	"circle-stroke-width": 1,
};

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

// GPU version of roiBoxStyle above.
const roiBoxFlatStyle: FlatStyle = {
	"stroke-color": ROI_BOX_COLOUR,
	"stroke-width": 2,
	"stroke-line-dash": [6, 4],
	"fill-color": `${ROI_BOX_COLOUR}1a`,
};

const RULER_COLOUR = "#ff9f1c";

function rulerDistanceLabel(line: LineString, mppX: number | null, mppY: number | null): string | undefined {
	const coords = line.getCoordinates();
	if (coords.length < 2) return undefined;
	const [x1, y1] = coords[0];
	const [x2, y2] = coords[coords.length - 1];
	const dx = x2 - x1;
	const dy = y2 - y1;
	return mppX !== null && mppY !== null
		? formatDistanceMicrons(physicalDistanceMicrons(dx, dy, mppX, mppY))
		: formatDistancePixels(pixelDistance(dx, dy));
}

// Canvas text can't read CSS custom properties, so the font stack here is
// index.css's --sans spelled out literally rather than referenced.
function rulerTextStyle(label: string | undefined): Text | undefined {
	return label
		? new Text({
				text: label,
				font: "600 13px 'Source Sans Pro', Arial, sans-serif",
				fill: new Fill({ color: "#fff" }),
				stroke: new Stroke({ color: "#000", width: 3 }),
				offsetY: -12,
			})
		: undefined;
}

// The finished, measured line plus its distance label - the label text
// itself is computed once at drawend and carried as a feature property
// (same convention as annotationStyle's colour/shape), since it only
// depends on the slide's fixed mpp, not anything that changes per render.
function rulerStyle(feature: FeatureLike): Style {
	const label = feature.get("label") as string | undefined;
	return new Style({
		stroke: new Stroke({ color: RULER_COLOUR, width: 2 }),
		text: rulerTextStyle(label),
	});
}

// Live in-progress sketch style, mirroring sketchStyle's approach for
// annotations - recomputes the distance label from the geometry itself on
// every pointer move, since a mid-drag feature has no properties set on it
// yet for rulerStyle to read.
function rulerSketchStyle(mppX: number | null, mppY: number | null) {
	return (feature: FeatureLike): Style => {
		const geometry = feature.getGeometry();
		const label = geometry instanceof LineString ? rulerDistanceLabel(geometry, mppX, mppY) : undefined;
		return new Style({
			stroke: new Stroke({ color: RULER_COLOUR, width: 2, lineDash: [6, 4] }),
			text: rulerTextStyle(label),
		});
	};
}

export {
	annotationStyle,
	annotationFlatStyle,
	annotationArrowHeadStyle,
	setAnnotationRenderProperties,
	sketchStyle,
	cellCountDotStyle,
	cellCountDotFlatStyle,
	roiBoxStyle,
	roiBoxFlatStyle,
	rulerStyle,
	rulerSketchStyle,
	arrowHeadRadius,
	dashPattern,
};
