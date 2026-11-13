import { buildVolume, thumbnailUrl, type SliceImage, type Volume } from "./volume";
import type { Slice } from "./slices";

// Fetches each slice's picture from the tiler and stacks them (see
// buildVolume). Kept per slide for as long as the page is open, so going
// back and forth between 2D and 3D doesn't fetch them again - the tiler
// says they can be cached for a day anyway.
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

function loadVolume(tilerUrl: string, slideId: string, slices: readonly Slice[], onProgress?: (done: number, total: number) => void): Promise<Volume> {
	const key = `${tilerUrl}|${slideId}|${slices.length}`;
	const cached = loaded.get(key);
	if (cached) {
		onProgress?.(slices.length, slices.length);
		return cached;
	}
	let done = 0;
	const promise = Promise.all(
		slices.map((slice) =>
			slicePicture(thumbnailUrl(tilerUrl, slideId, slice.index)).then((picture) => {
				done++;
				onProgress?.(done, slices.length);
				return picture;
			}),
		),
	).then((pictures) => buildVolume(pictures, slices));
	loaded.set(key, promise);
	// A failure shouldn't stick - the next try fetches again.
	promise.catch(() => loaded.delete(key));
	return promise;
}

export { loadVolume };
