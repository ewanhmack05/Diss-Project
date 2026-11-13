import type { Slice } from "./slices";

// The 3D view's block: every slice of a volume, small, stacked into one 3D
// texture. Built in the browser from the tiler's thumbnail of each slice, so
// there's nothing extra to make or keep on the server.

// How wide each slice's picture is. The liver volume is 40288 px wide, so
// this is 1/79 - about 21.5 um a pixel - and the whole block is 512 x 573 x 16
// RGBA, 18 MB. Plenty to see its shape; the 2D view is where the detail is.
const BLOCK_WIDTH = 512;

// Nobody's said how thick the liver set's sections are. 4 um is the usual
// for paraffin sections, and is what the 3D view assumes - see blockSize.
const ASSUMED_SECTION_MICRONS = 4;

// Sections are thin next to how wide they are - 15 of them at 4 um is 60 um,
// against 11 mm across - so the block's drawn this many times thicker than
// it really is by default, or it'd be a sheet of paper. The panel can change
// it, and says so.
const DEFAULT_STRETCH_OF_WIDTH = 0.2;

interface SliceImage {
	data: Uint8ClampedArray;
	width: number;
	height: number;
}

// One layer of the 3D texture per slice, plus an empty one wherever there's
// a gap - so the block shows a break there instead of joining two runs of
// cuts as if they touched. Colours are premultiplied by alpha.
interface Volume {
	rgba: Uint8Array;
	width: number;
	height: number;
	depth: number;
	// For each layer, the slice it is, or null for a gap.
	layerSlice: (number | null)[];
}

// Glass is grey and stain is coloured, so how saturated a pixel is says how
// much tissue it is - the same test register_sections.py uses. Below 20 (of
// 255) is glass and see-through; from 60 up it's solid; a ramp between keeps
// the edges soft rather than jagged.
const GLASS_SATURATION = 20;
const TISSUE_SATURATION = 60;

function tissueAlpha(r: number, g: number, b: number): number {
	const max = Math.max(r, g, b);
	if (max === 0) return 0;
	const saturation = ((max - Math.min(r, g, b)) / max) * 255;
	if (saturation <= GLASS_SATURATION) return 0;
	if (saturation >= TISSUE_SATURATION) return 255;
	return Math.round(((saturation - GLASS_SATURATION) / (TISSUE_SATURATION - GLASS_SATURATION)) * 255);
}

// Which slice each layer is: the slices in order, with an empty layer before
// any slice that has a gap before it.
function layerSlices(slices: readonly Slice[]): (number | null)[] {
	const layers: (number | null)[] = [];
	for (const slice of slices) {
		if (slice.gapBefore && layers.length > 0) layers.push(null);
		layers.push(slice.index);
	}
	return layers;
}

function buildVolume(images: readonly SliceImage[], slices: readonly Slice[]): Volume {
	if (images.length !== slices.length) throw new Error(`${images.length} pictures for ${slices.length} slices`);
	if (images.length === 0) throw new Error("no slices");
	const { width, height } = images[0];
	for (const image of images) {
		if (image.width !== width || image.height !== height) {
			throw new Error(`slice pictures differ in size: ${image.width}x${image.height} and ${width}x${height}`);
		}
	}
	const layerSlice = layerSlices(slices);
	const layerSize = width * height * 4;
	const rgba = new Uint8Array(layerSize * layerSlice.length);
	layerSlice.forEach((slice, layer) => {
		if (slice === null) return;
		const source = images[slice].data;
		const offset = layer * layerSize;
		for (let i = 0; i < layerSize; i += 4) {
			const alpha = tissueAlpha(source[i], source[i + 1], source[i + 2]);
			// Premultiplied: the GPU blends neighbouring voxels when it samples, and
			// blending tissue with glass or a gap would otherwise darken the colour
			// even though they add nothing to it.
			rgba[offset + i] = Math.round((source[i] * alpha) / 255);
			rgba[offset + i + 1] = Math.round((source[i + 1] * alpha) / 255);
			rgba[offset + i + 2] = Math.round((source[i + 2] * alpha) / 255);
			rgba[offset + i + 3] = alpha;
		}
	});
	return { rgba, width, height, depth: layerSlice.length, layerSlice };
}

// The block's size in the scene, width 1. Height keeps the slide's shape.
// Depth is how thick the sections really are against how wide the slide is,
// times stretch.
function blockSize(
	slideWidth: number,
	slideHeight: number,
	layers: number,
	micronsPerPixel: number | null,
	stretch: number,
	sectionMicrons = ASSUMED_SECTION_MICRONS,
): [number, number, number] {
	const trueDepth = micronsPerPixel ? (layers * sectionMicrons) / (slideWidth * micronsPerPixel) : layers / BLOCK_WIDTH;
	return [1, slideHeight / slideWidth, trueDepth * stretch];
}

// The stretch that makes the block DEFAULT_STRETCH_OF_WIDTH as deep as it's wide.
function defaultStretch(slideWidth: number, layers: number, micronsPerPixel: number | null, sectionMicrons = ASSUMED_SECTION_MICRONS): number {
	const [, , trueDepth] = blockSize(slideWidth, 1, layers, micronsPerPixel, 1, sectionMicrons);
	return trueDepth > 0 ? DEFAULT_STRETCH_OF_WIDTH / trueDepth : 1;
}

type CutAxis = "none" | "x" | "y" | "z" | "diagonal";

// A cut as a plane in texture space (each axis 0-1): what's kept is where
// normal . p <= offset. position (0-1) is how far through the block it is.
// A diagonal cut runs across all three axes, like DPLab's.
function cutPlane(axis: CutAxis, position: number): { normal: [number, number, number]; offset: number } {
	const t = Math.min(1, Math.max(0, position));
	switch (axis) {
		case "x":
			return { normal: [1, 0, 0], offset: t };
		case "y":
			return { normal: [0, 1, 0], offset: t };
		case "z":
			return { normal: [0, 0, 1], offset: t };
		case "diagonal": {
			const n = 1 / Math.sqrt(3);
			// n . p runs from 0 at one corner to sqrt(3) * n = 1 at the other.
			return { normal: [n, n, n], offset: t * Math.sqrt(3) };
		}
		default:
			return { normal: [0, 0, 0], offset: 1 };
	}
}

interface Clip {
	normal: [number, number, number];
	offset: number;
	// Which layers are drawn, inclusive - fewer layers is a thinner block.
	firstLayer: number;
	lastLayer: number;
}

// The first solid voxel along a ray, in texture space (each axis 0-1, y down
// the slide, z through the layers) - what a click in the 3D view lands on. The
// same clip as the drawing, so a click can't land on what's been cut away.
// Null if the ray goes through without hitting tissue.
function firstHit(
	volume: Pick<Volume, "rgba" | "width" | "height" | "depth">,
	origin: [number, number, number],
	direction: [number, number, number],
	clip: Clip,
	threshold = 128,
): { x: number; y: number; layer: number } | null {
	// Where the ray is inside the unit box.
	let near = -Infinity;
	let far = Infinity;
	for (let axis = 0; axis < 3; axis++) {
		const o = origin[axis];
		const d = direction[axis];
		if (Math.abs(d) < 1e-12) {
			if (o < 0 || o > 1) return null;
			continue;
		}
		const a = (0 - o) / d;
		const b = (1 - o) / d;
		near = Math.max(near, Math.min(a, b));
		far = Math.min(far, Math.max(a, b));
	}
	if (far < Math.max(near, 0)) return null;
	near = Math.max(near, 0);
	const length = Math.hypot(...direction);
	// Half a voxel along the finest axis at a time.
	const step = 0.5 / Math.max(volume.width, volume.height, volume.depth) / length;
	for (let t = near; t <= far; t += step) {
		const p = [origin[0] + direction[0] * t, origin[1] + direction[1] * t, origin[2] + direction[2] * t];
		if (clip.normal[0] * p[0] + clip.normal[1] * p[1] + clip.normal[2] * p[2] > clip.offset) continue;
		const x = Math.min(volume.width - 1, Math.max(0, Math.floor(p[0] * volume.width)));
		const y = Math.min(volume.height - 1, Math.max(0, Math.floor(p[1] * volume.height)));
		const layer = Math.min(volume.depth - 1, Math.max(0, Math.floor(p[2] * volume.depth)));
		if (layer < clip.firstLayer || layer > clip.lastLayer) continue;
		const alpha = volume.rgba[((layer * volume.height + y) * volume.width + x) * 4 + 3];
		if (alpha >= threshold) return { x: p[0], y: p[1], layer };
	}
	return null;
}

type Vec3 = [number, number, number];

// A ray in the scene (the box centred on the origin, size big) into texture
// space - the same flips as the shader's textureSpace: y down the slide, and
// layer 0 at the front (+z).
function textureRay(origin: Vec3, direction: Vec3, size: Vec3): { origin: Vec3; direction: Vec3 } {
	return {
		origin: [origin[0] / size[0] + 0.5, 0.5 - origin[1] / size[1], 0.5 - origin[2] / size[2]],
		direction: [direction[0] / size[0], -direction[1] / size[1], -direction[2] / size[2]],
	};
}

// Where the middle of a layer is along the scene's z, for a box of depth.
function layerZ(layer: number, layers: number, depth: number): number {
	return (0.5 - (layer + 0.5) / layers) * depth;
}

function thumbnailUrl(tilerUrl: string, slideId: string, slice: number, width = BLOCK_WIDTH): string {
	return `${tilerUrl}/slides/${encodeURIComponent(slideId)}/thumbnail.jpg?width=${width}&slice=${slice}`;
}

export {
	BLOCK_WIDTH,
	ASSUMED_SECTION_MICRONS,
	tissueAlpha,
	layerSlices,
	buildVolume,
	blockSize,
	defaultStretch,
	cutPlane,
	firstHit,
	textureRay,
	layerZ,
	thumbnailUrl,
};
export type { SliceImage, Volume, CutAxis, Clip, Vec3 };
