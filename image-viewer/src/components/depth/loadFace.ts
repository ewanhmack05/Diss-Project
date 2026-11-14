import { tileUrl } from "../messages/previewTiles";
import { keepRecent } from "./keepRecent";
import { faceLength, faceTiles, writeTissue, type DetailTier, type FaceAxis, type FaceTile } from "./volume";

// The sharp face of an X or Y cut (see faceTier): for each slice, the line of
// pixels the cut goes through, read out of that slice's tiles. One row of the
// picture per layer, so it lines up with the block's layers.

interface Face {
	axis: FaceAxis;
	// Pixels along the face, and layers through it.
	length: number;
	layers: number;
	// Premultiplied RGBA, length x layers, glass see-through - the same as the block.
	rgba: Uint8Array;
	// One RGBA texel per layer, alpha 255 once that layer's line is in. Gap
	// layers never are, so the block shows there.
	ready: Uint8Array;
}

// Slices fetched at once, each one tile at a time.
const PARALLEL = 8;
// Finished faces kept for going back to - under 4 MB each.
const KEEP = 2;

const finished = new Map<string, Face>();

async function tileImage(url: string, signal: AbortSignal): Promise<ImageBitmap> {
	const response = await fetch(url, { signal });
	if (!response.ok) throw new Error(`${response.status} for ${url}`);
	return createImageBitmap(await response.blob());
}

// One slice's line: the picked column (X cut) or row (Y cut) of each tile,
// end to end.
async function sliceLine(url: (tile: FaceTile) => string, tiles: readonly FaceTile[], axis: FaceAxis, length: number, signal: AbortSignal): Promise<Uint8ClampedArray> {
	const canvas = document.createElement("canvas");
	canvas.width = axis === "x" ? 1 : length;
	canvas.height = axis === "x" ? length : 1;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) throw new Error("no 2D canvas");
	for (const tile of tiles) {
		const bitmap = await tileImage(url(tile), signal);
		if (axis === "x") {
			const pick = Math.min(tile.pick, bitmap.width - 1);
			context.drawImage(bitmap, pick, 0, 1, bitmap.height, 0, tile.at, 1, bitmap.height);
		} else {
			const pick = Math.min(tile.pick, bitmap.height - 1);
			context.drawImage(bitmap, 0, pick, bitmap.width, 1, tile.at, 0, bitmap.width, 1);
		}
		bitmap.close();
	}
	return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

// Starts on the face, calling onLayer each time another layer's line is in -
// the same Face each time, filling up. A face that's been finished before
// comes straight back, whole.
function loadFace(
	tilerUrl: string,
	slideId: string,
	layerSlice: readonly (number | null)[],
	tier: DetailTier,
	tileSize: number,
	axis: FaceAxis,
	pixel: number,
	onLayer: (face: Face, done: number, total: number) => void,
): { face: Promise<Face>; cancel: () => void } {
	const key = `${tilerUrl}|${slideId}|${layerSlice.join(",")}|${tier.z}|${axis}|${pixel}`;
	const cached = finished.get(key);
	if (cached) {
		keepRecent(finished, key, cached, KEEP);
		return { face: Promise.resolve(cached), cancel: () => {} };
	}
	const controller = new AbortController();
	const length = faceLength(tier, axis);
	const face: Face = {
		axis,
		length,
		layers: layerSlice.length,
		rgba: new Uint8Array(length * layerSlice.length * 4),
		ready: new Uint8Array(layerSlice.length * 4),
	};
	const tiles = faceTiles(tier, tileSize, axis, pixel);
	const jobs = layerSlice.flatMap((slice, layer) => (slice === null ? [] : [{ slice, layer }]));
	let next = 0;
	let done = 0;
	const worker = async () => {
		while (next < jobs.length) {
			const { slice, layer } = jobs[next++];
			const line = await sliceLine((tile) => tileUrl(tilerUrl, slideId, tile, slice), tiles, axis, length, controller.signal);
			if (controller.signal.aborted) return;
			writeTissue(line, face.rgba, layer * length * 4);
			face.ready[layer * 4 + 3] = 255;
			done++;
			onLayer(face, done, jobs.length);
		}
	};
	const all = Promise.all(Array.from({ length: Math.min(PARALLEL, jobs.length) }, worker)).then(() => {
		// Cancelled between tiles: part done, so not one to keep.
		if (controller.signal.aborted) throw new DOMException("cancelled", "AbortError");
		keepRecent(finished, key, face, KEEP);
		return face;
	});
	return { face: all, cancel: () => controller.abort() };
}

export { loadFace };
export type { Face };
