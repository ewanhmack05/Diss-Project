import Feature from "ol/Feature";
import type Map from "ol/Map";
import type Geometry from "ol/geom/Geometry";
import LineString from "ol/geom/LineString";
import MultiLineString from "ol/geom/MultiLineString";
import MultiPolygon from "ol/geom/MultiPolygon";
import Polygon, { fromExtent } from "ol/geom/Polygon";
import { getHeight, getWidth } from "ol/extent";
import { douglasPeuckerArray } from "ol/geom/flat/simplify";
import type { EventsKey } from "ol/events";
import { unByKey } from "ol/Observable";
import VectorSource from "ol/source/Vector";

// Zoomed out, a shape's points sit far closer together than the screen's
// pixels, and the GPU still draws every one - at the fitted view that's
// what makes 25k annotations slow. Below FullDetailBelow slide pixels per
// screen pixel shapes are drawn as saved. Past it the levels go up in steps
// of 4x zoom, each dropping what's within half a screen pixel of the line
// at the sharpest zoom it's used at - so it never shows.
export const FullDetailBelow = 2;
const Step = 4;

export function detailLevel(resolution: number): number {
	if (!(resolution >= FullDetailBelow)) return 0;
	let level = 1;
	for (let edge = FullDetailBelow * Step; resolution >= edge; edge *= Step) level++;
	return level;
}

// How far, in slide pixels, a level can move a point.
export function toleranceFor(level: number): number {
	return level === 0 ? 0 : (FullDetailBelow * Step ** (level - 1)) / 2;
}

function collapsed(geometry: Geometry): boolean {
	if (geometry instanceof Polygon) return geometry.getLinearRings().some((ring) => ring.getCoordinates().length < 4);
	if (geometry instanceof MultiPolygon) return geometry.getPolygons().some(collapsed);
	if (geometry instanceof LineString) return geometry.getCoordinates().length < 2;
	if (geometry instanceof MultiLineString) return geometry.getLineStrings().some(collapsed);
	return false;
}

// OpenLayers simplifies polygons by snapping them to a grid, which keeps
// most of a freehand trace's points - Douglas-Peucker, as it does lines,
// drops every point within the tolerance of the outline.
function simplerPolygon(polygon: Polygon, tolerance: number): Polygon {
	const flat: number[] = [];
	const ends: number[] = [];
	flat.length = douglasPeuckerArray(polygon.getFlatCoordinates(), 0, polygon.getEnds(), polygon.getStride(), tolerance * tolerance, flat, 0, ends);
	return new Polygon(flat, polygon.getLayout(), ends);
}

function simpler(geometry: Geometry, tolerance: number): Geometry {
	if (geometry instanceof Polygon) return simplerPolygon(geometry, tolerance);
	if (geometry instanceof MultiPolygon) return new MultiPolygon(geometry.getPolygons().map((p) => simplerPolygon(p, tolerance)));
	return geometry.simplify(tolerance);
}

export function simplified(geometry: Geometry, level: number): Geometry {
	const tolerance = toleranceFor(level);
	if (tolerance === 0) return geometry;
	const fewer = simpler(geometry, tolerance);
	if (!collapsed(fewer)) return fewer;
	// Smaller than the step it was snapped to. Under a pixel across, a box
	// looks the same; anything bigger keeps every point rather than turn
	// into a different shape.
	const extent = geometry.getExtent();
	return getWidth(extent) <= 2 * tolerance && getHeight(extent) <= 2 * tolerance ? fromExtent(extent) : geometry;
}

export function pointCount(geometry: Geometry | undefined): number {
	const flat = (geometry as { getFlatCoordinates?: () => number[]; getStride?: () => number } | undefined) ?? {};
	return flat.getFlatCoordinates && flat.getStride ? flat.getFlatCoordinates().length / flat.getStride() : 0;
}

// What the GPU layer draws: a copy of every feature in `full`, at the
// detail the view's zoom needs. `full` stays as saved for everything that
// reads shapes - picking, the arrowheads, fitting to one - and the copies
// follow it, colour changes and all. A new level goes in once the view
// stops moving, which is when the GPU layer rebuilds its buffers anyway.
export class LessDetail {
	readonly source = new VectorSource();
	private copies = new globalThis.Map<Feature, Feature>();
	private levels = new WeakMap<Geometry, { revision: number; byLevel: globalThis.Map<number, Geometry> }>();
	private changed = new Set<Feature>();
	private rebuildAll = true;
	private scheduled = false;
	private disposed = false;
	private level = 0;
	private fullKeys: EventsKey[];
	private mapKey: EventsKey | null = null;
	private readonly full: VectorSource;

	constructor(full: VectorSource) {
		this.full = full;
		this.fullKeys = [
			full.on("addfeature", (e) => this.queue(e.feature)),
			full.on("changefeature", (e) => this.queue(e.feature)),
			full.on("removefeature", (e) => this.queue(e.feature)),
			full.on("clear", () => {
				this.rebuildAll = true;
				this.schedule();
			}),
		];
		this.schedule();
	}

	follow(map: Map): void {
		if (this.mapKey) unByKey(this.mapKey);
		const view = () => map.getView().getResolution() ?? 0;
		this.setLevel(detailLevel(view()));
		this.mapKey = map.on("moveend", () => this.setLevel(detailLevel(view())));
	}

	getLevel(): number {
		return this.level;
	}

	setLevel(level: number): void {
		if (level === this.level) return;
		this.level = level;
		this.rebuildAll = true;
		this.flush();
	}

	dispose(): void {
		this.disposed = true;
		unByKey(this.fullKeys);
		if (this.mapKey) unByKey(this.mapKey);
		this.source.dispose();
	}

	// MapNode refills the whole source on every change, a feature at a time -
	// copy once, after the last of them.
	private queue(feature: Feature | undefined): void {
		if (feature) this.changed.add(feature);
		this.schedule();
	}

	private schedule(): void {
		if (this.scheduled) return;
		this.scheduled = true;
		queueMicrotask(() => {
			this.scheduled = false;
			this.flush();
		});
	}

	// Kept per level, so zooming back to one is free. A geometry edited in
	// place has a new revision, and starts again.
	private geometryAt(geometry: Geometry): Geometry {
		if (this.level === 0) return geometry;
		let cached = this.levels.get(geometry);
		if (!cached || cached.revision !== geometry.getRevision()) {
			cached = { revision: geometry.getRevision(), byLevel: new globalThis.Map() };
			this.levels.set(geometry, cached);
		}
		let at = cached.byLevel.get(this.level);
		if (!at) {
			at = simplified(geometry, this.level);
			cached.byLevel.set(this.level, at);
		}
		return at;
	}

	private copyProperties(feature: Feature): Record<string, unknown> {
		const geometry = feature.getGeometry();
		return { ...feature.getProperties(), geometry: geometry ? this.geometryAt(geometry) : undefined };
	}

	private flush(): void {
		if (this.disposed) return;
		if (this.rebuildAll) {
			this.rebuildAll = false;
			this.changed.clear();
			this.copies.clear();
			const copies = this.full.getFeatures().map((feature) => {
				const copy = new Feature(this.copyProperties(feature));
				copy.setId(feature.getId());
				this.copies.set(feature, copy);
				return copy;
			});
			this.source.clear(true);
			this.source.addFeatures(copies);
			return;
		}
		for (const feature of this.changed) {
			const copy = this.copies.get(feature);
			if (!this.full.hasFeature(feature)) {
				if (copy) this.source.removeFeature(copy);
				this.copies.delete(feature);
			} else if (copy) {
				copy.setProperties(this.copyProperties(feature));
			} else {
				const added = new Feature(this.copyProperties(feature));
				added.setId(feature.getId());
				this.copies.set(feature, added);
				this.source.addFeature(added);
			}
		}
		this.changed.clear();
	}
}
