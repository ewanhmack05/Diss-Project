import { keepRecent } from "./keepRecent";
import { addSlice, emptyVolume, thumbnailUrl, type SliceImage, type Volume } from "./volume";
import type { Slice } from "./slices";

// Fetches each slice's picture from the tiler and stacks them (see
// buildVolume). The last few are kept, so going back and forth between 2D
// and 3D doesn't fetch them again - the tiler says they can be cached for a
// day anyway. Only a few: a block can be 256 MB.
const KEEP = 2;
const loaded = new Map<string, Promise<Volume>>();

async function slicePicture(url: string): Promise<SliceImage> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${response.status} for ${url}`);
	const bitmap = await createImageBitmap(await response.blob());
	const canvas = document.createElement("canvas");
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) throw new Error("no 2D canvas");
	context.drawImage(bitmap, 0, 0);
	bitmap.close();
	const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
	return { data, width, height };
}

function loadVolume(
	tilerUrl: string,
	slideId: string,
	slices: readonly Slice[],
	width: number,
	onProgress?: (done: number, total: number) => void,
): Promise<Volume> {
	const key = `${tilerUrl}|${slideId}|${slices.length}|${width}`;
	const cached = loaded.get(key);
	if (cached) {
		keepRecent(loaded, key, cached, KEEP);
		onProgress?.(slices.length, slices.length);
		return cached;
	}
	let done = 0;
	// Each picture goes into the block as it comes in and is let go, rather
	// than all of them being held until the last arrives - at 1024 wide that's
	// as much again as the block.
	let volume: Volume | null = null;
	const promise = Promise.all(
		slices.map((slice) =>
			slicePicture(thumbnailUrl(tilerUrl, slideId, slice.index, width)).then((picture) => {
				volume ??= emptyVolume(picture.width, picture.height, slices);
				addSlice(volume, slice.index, picture);
				done++;
				onProgress?.(done, slices.length);
			}),
		),
	).then(() => {
		if (!volume) throw new Error("no slices");
		return volume;
	});
	keepRecent(loaded, key, promise, KEEP);
	// A failure shouldn't stick - the next try fetches again.
	promise.catch(() => loaded.delete(key));
	return promise;
}

export { loadVolume };
