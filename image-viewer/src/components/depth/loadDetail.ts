import { tilesAt, tileUrl, type SlideInfo } from "../messages/previewTiles";
import { keepRecent } from "./keepRecent";
import { detailTier, writeTissue } from "./volume";

// One slice at full detail for the 3D view (see detailSlice), put together
// from the same tiles the 2D view shows - so they're usually cached already,
// and the tiler never has to hold a big picture in memory to make it.

interface Detail {
	slice: number;
	// Premultiplied RGBA, glass see-through - the same as the block.
	rgba: Uint8Array;
	width: number;
	height: number;
}

// Tiles fetched at once. Browsers allow about 6 connections to a host
// anyway; a few more keeps the queue full.
const PARALLEL = 8;
// Details kept for going back to - 64 MB each at most.
const KEEP = 2;

const loaded = new Map<string, Promise<Detail>>();

async function tileImage(url: string, signal: AbortSignal): Promise<ImageBitmap> {
	const response = await fetch(url, { signal });
	if (!response.ok) throw new Error(`${response.status} for ${url}`);
	return createImageBitmap(await response.blob());
}

async function build(tilerUrl: string, slideId: string, slice: number, slide: SlideInfo, maxSide: number, signal: AbortSignal): Promise<Detail> {
	const tier = detailTier(slide, maxSide);
	const tiles = tilesAt(tier, slide.tileSize, { left: 0, top: 0, right: slide.width - 1, bottom: slide.height - 1 });
	const canvas = document.createElement("canvas");
	canvas.width = tier.width;
	canvas.height = tier.height;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) throw new Error("no 2D canvas");
	let next = 0;
	const worker = async () => {
		while (next < tiles.length) {
			const tile = tiles[next++];
			const bitmap = await tileImage(tileUrl(tilerUrl, slideId, tile, slice), signal);
			context.drawImage(bitmap, tile.x * slide.tileSize, tile.y * slide.tileSize);
			bitmap.close();
		}
	};
	await Promise.all(Array.from({ length: Math.min(PARALLEL, tiles.length) }, worker));
	const { data } = context.getImageData(0, 0, tier.width, tier.height);
	const rgba = new Uint8Array(data.length);
	writeTissue(data, rgba);
	// Let the canvas's memory go now rather than whenever it's collected.
	canvas.width = 0;
	canvas.height = 0;
	return { slice, rgba, width: tier.width, height: tier.height };
}

function loadDetail(tilerUrl: string, slideId: string, slice: number, slide: SlideInfo, maxSide: number): { detail: Promise<Detail>; cancel: () => void } {
	const key = `${tilerUrl}|${slideId}|${slice}|${maxSide}`;
	const cached = loaded.get(key);
	if (cached) {
		keepRecent(loaded, key, cached, KEEP);
		return { detail: cached, cancel: () => {} };
	}
	const controller = new AbortController();
	let finished = false;
	const detail = build(tilerUrl, slideId, slice, slide, maxSide, controller.signal);
	keepRecent(loaded, key, detail, KEEP);
	detail.then(
		() => {
			finished = true;
		},
		// A failed or cancelled one shouldn't stick.
		() => {
			if (loaded.get(key) === detail) loaded.delete(key);
		},
	);
	return {
		detail,
		// Stops the tiles still coming. One that's finished is kept for later.
		cancel: () => {
			if (finished) return;
			// Out of the cache now, so asking again straight after starts afresh.
			if (loaded.get(key) === detail) loaded.delete(key);
			controller.abort();
		},
	};
}

export { loadDetail };
export type { Detail };
