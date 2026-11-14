import { describe, expect, it } from "vitest";
import Collection from "ol/Collection";
import BaseLayer from "ol/layer/Base";
import { SliceLayers, type SliceLayer } from "./sliceLayers";

// A stand-in for WebGLTileLayer: remembers its source and style, and
// whether it's been disposed. BaseLayer gives it the real opacity.
class FakeLayer extends BaseLayer implements SliceLayer<string> {
	source = "";
	variables: Record<string, number> = {};
	disposed = false;
	setSource(source: string) {
		this.source = source;
	}
	updateStyleVariables(variables: Record<string, number>) {
		this.variables = { ...variables };
	}
	override dispose() {
		this.disposed = true;
	}
}

function setUp(other: BaseLayer[] = []) {
	const mapLayers = new Collection<BaseLayer>([...other]);
	const made: FakeLayer[] = [];
	const tiles = new SliceLayers<string>(
		mapLayers,
		() => {
			const layer = new FakeLayer({});
			made.push(layer);
			return layer;
		},
		(slice) => `slide-a/${slice ?? "default"}`,
	);
	const onMap = () => mapLayers.getArray().filter((layer): layer is FakeLayer => layer instanceof FakeLayer);
	const showing = () => onMap().filter((layer) => layer.getOpacity() === 1);
	return { mapLayers, made, tiles, onMap, showing };
}

describe("SliceLayers", () => {
	it("shows a flat slide as one layer on the slide's own route", () => {
		const { tiles, onMap, showing } = setUp();
		tiles.show(null, [null]);

		expect(onMap()).toHaveLength(1);
		expect(showing()[0].source).toBe("slide-a/default");
	});

	it("shows the slice and loads its neighbours at no opacity", () => {
		const { tiles, onMap, showing } = setUp();
		tiles.show(7, [7, 6, 8]);

		expect(onMap().map((layer) => layer.source).sort()).toEqual(["slide-a/6", "slide-a/7", "slide-a/8"]);
		expect(showing().map((layer) => layer.source)).toEqual(["slide-a/7"]);
	});

	it("steps to a neighbour without a new source - it's already loaded", () => {
		const { tiles, onMap } = setUp();
		tiles.show(7, [7, 6, 8]);
		const eight = onMap().find((layer) => layer.source === "slide-a/8")!;

		tiles.show(8, [8, 7, 9]);

		expect(eight.getOpacity()).toBe(1);
		expect(eight.source).toBe("slide-a/8");
	});

	it("reuses the layer that dropped out instead of making another GL context", () => {
		const { tiles, made, onMap } = setUp();
		tiles.show(7, [7, 6, 8]);
		const six = onMap().find((layer) => layer.source === "slide-a/6")!;

		tiles.show(8, [8, 7, 9]);

		expect(made).toHaveLength(3);
		expect(six.source).toBe("slide-a/9");
		expect(onMap()).toHaveLength(3);
	});

	it("never makes more layers than the biggest window, all the way through", () => {
		const { tiles } = setUp();
		for (let slice = 0; slice < 15; slice++) tiles.show(slice, [slice, slice - 1, slice + 1].filter((s) => s >= 0 && s < 15));
		for (let slice = 14; slice >= 0; slice--) tiles.show(slice, [slice, slice - 1, slice + 1].filter((s) => s >= 0 && s < 15));

		expect(tiles.layersMade()).toBe(3);
	});

	it("goes under the other layers so annotations stay on top", () => {
		const annotations = new BaseLayer({});
		const { tiles, mapLayers } = setUp([annotations]);
		tiles.show(7, [7, 6, 8]);

		expect(mapLayers.getArray().at(-1)).toBe(annotations);
	});

	it("gives every layer the adjustments, including ones loaded later", () => {
		const { tiles, onMap } = setUp();
		tiles.show(0, [0, 1]);
		tiles.setStyleVariables({ brightness: 0.2 });
		tiles.show(1, [1, 0, 2]);

		for (const layer of onMap()) expect(layer.variables).toEqual({ brightness: 0.2 });
	});

	it("moves to another slide with the same layers, nothing shown until asked", () => {
		const { tiles, made, onMap } = setUp();
		tiles.show(7, [7, 6, 8]);

		tiles.reset((slice) => `slide-b/${slice ?? "default"}`);
		expect(onMap()).toHaveLength(0);
		expect(tiles.current()).toBeUndefined();

		tiles.show(null, [null]);
		expect(onMap().map((layer) => layer.source)).toEqual(["slide-b/default"]);
		expect(made).toHaveLength(3);
	});

	it("disposes every layer, spares too, when the map goes", () => {
		const { tiles, made, onMap } = setUp();
		tiles.show(7, [7, 6, 8]);
		tiles.show(null, [null]);

		tiles.dispose();

		expect(made.every((layer) => layer.disposed)).toBe(true);
		expect(onMap()).toHaveLength(0);
	});

	it("says which slice is showing", () => {
		const { tiles } = setUp();
		tiles.show(3, [3, 2, 4]);

		expect(tiles.current()?.getOpacity()).toBe(1);
		expect(tiles.loadedSlices().sort()).toEqual([2, 3, 4]);
	});
});
