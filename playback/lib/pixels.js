import { PNG } from "pngjs";

// The pixels of one area of a screenshot. Screenshot the whole page and cut it
// here - asking the browser for a clipped screenshot makes the page flash grey
// for a frame in the recording, 22 times in 19 seconds when measured, against
// none for whole page ones.
export function region(png, { x, y, width, height }) {
	const { data, width: fullWidth, height: fullHeight } = PNG.sync.read(png);
	if (x < 0 || y < 0 || x + width > fullWidth || y + height > fullHeight) {
		throw new Error(`${width}x${height} at ${x},${y} is outside the ${fullWidth}x${fullHeight} screenshot`);
	}
	const out = Buffer.alloc(width * height * 4);
	for (let row = 0; row < height; row++) {
		const start = ((y + row) * fullWidth + x) * 4;
		data.copy(out, row * width * 4, start, start + width * 4);
	}
	return out;
}
