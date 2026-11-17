import type Collection from "ol/Collection";
import type BaseLayer from "ol/layer/Base";

// What SliceLayers needs from a tile layer - WebGLTileLayer in the app,
// stand-ins in the tests.
interface SliceLayer<S> extends BaseLayer {
	setSource(source: S): void;
	updateStyleVariables(variables: Record<string, number>): void;
	dispose(): void;
}

type StyleVariables = Record<string, number>;

// The main map's slide tiles: one layer per slice that's loaded, the one
// showing at full opacity and its neighbours at none. A layer at opacity 0
// still loads and draws its tiles - a hidden one wouldn't - so stepping to a
// neighbour is just swapping opacities, with nothing to fetch.
//
// Each layer is a WebGL tile layer with a GL context of its own, and
// browsers only allow about 16, so layers are never thrown away while the
// map's there: one that drops out of the window is taken off the map and
// kept, and the next slice that needs a layer gets it with a new source.
// So there are never more layers than the biggest window shown, and moving
// through slices - or to another slide - makes no new GL contexts. A flat
// slide is the one layer, for slice null (the slide's own route).
class SliceLayers<S> {
	private readonly loaded = new Map<number | null, SliceLayer<S>>();
	private readonly spare: SliceLayer<S>[] = [];
	private showing: number | null = null;
	private variables: StyleVariables = {};
	private made = 0;
	private readonly mapLayers: Collection<BaseLayer>;
	private readonly newLayer: () => SliceLayer<S>;
	private sourceFor: (slice: number | null) => S;

	constructor(mapLayers: Collection<BaseLayer>, newLayer: () => SliceLayer<S>, sourceFor: (slice: number | null) => S) {
		this.mapLayers = mapLayers;
		this.newLayer = newLayer;
		this.sourceFor = sourceFor;
	}

	// Shows slice, with exactly the slices in wanted loaded (slice among them).
	show(slice: number | null, wanted: readonly (number | null)[]): void {
		const keep = new Set<number | null>(wanted);
		keep.add(slice);
		for (const [loadedSlice, layer] of this.loaded) {
			if (keep.has(loadedSlice)) continue;
			this.mapLayers.remove(layer);
			this.loaded.delete(loadedSlice);
			this.spare.push(layer);
		}
		for (const wantedSlice of keep) {
			if (this.loaded.has(wantedSlice)) continue;
			const layer = this.spare.pop() ?? this.make();
			layer.setSource(this.sourceFor(wantedSlice));
			// Under everything else - annotations, dots and the rest draw on top.
			this.mapLayers.insertAt(0, layer);
			this.loaded.set(wantedSlice, layer);
		}
		for (const [loadedSlice, layer] of this.loaded) layer.setOpacity(loadedSlice === slice ? 1 : 0);
		this.showing = slice;
	}

	// Brightness, contrast and the rest, on every layer - spares too, so a
	// slice loaded later already looks the same.
	setStyleVariables(variables: StyleVariables): void {
		this.variables = { ...variables };
		for (const layer of this.allLayers()) layer.updateStyleVariables(this.variables);
	}

	// Another slide. Its layers come from the same pool - nothing to show
	// until show() is called again.
	reset(sourceFor: (slice: number | null) => S): void {
		for (const layer of this.loaded.values()) {
			this.mapLayers.remove(layer);
			this.spare.push(layer);
		}
		this.loaded.clear();
		this.showing = null;
		this.sourceFor = sourceFor;
	}

	// The map's going - every GL context goes with it.
	dispose(): void {
		for (const layer of this.allLayers()) {
			this.mapLayers.remove(layer);
			layer.dispose();
		}
		this.loaded.clear();
		this.spare.length = 0;
	}

	// The layer showing, if any.
	current(): SliceLayer<S> | undefined {
		return this.loaded.get(this.showing);
	}

	loadedSlices(): (number | null)[] {
		return [...this.loaded.keys()];
	}

	// How many layers - so GL contexts - have ever been made.
	layersMade(): number {
		return this.made;
	}

	private make(): SliceLayer<S> {
		const layer = this.newLayer();
		layer.updateStyleVariables(this.variables);
		this.made++;
		return layer;
	}

	private allLayers(): SliceLayer<S>[] {
		return [...this.loaded.values(), ...this.spare];
	}
}

export { SliceLayers };
export type { SliceLayer, StyleVariables };
