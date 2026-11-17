import { tiersOf, type SlideInfo } from "../messages/previewTiles";
import type { Slice } from "./slices";

// The 3D view's block: every slice of a volume, small, stacked into one 3D
// texture. Built in the browser from the tiler's thumbnail of each slice, so
// there's nothing extra to make or keep on the server.

// How wide each slice's picture is, at most - the most the tiler's thumbnail
// gives. Kartasalo's liver is 32384 px wide, so this is 1/32, about 15 um a
// pixel, and its 52 layers are 215 MB as RGBA.
const BLOCK_WIDTH = 1024;
// The most voxels the block can have - 256 MB as RGBA. A volume with many
// slices gets narrower pictures to stay under it: the 260-slice prostate is
// about 450 wide. The slice being looked at is sharp anyway - see DETAIL_PIXELS.
const VOXEL_BUDGET = 64_000_000;
// The tiler won't make a thumbnail narrower than this.
const MIN_BLOCK_WIDTH = 32;

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

// A picture's pixels into target at offset, with glass see-through and colours
// premultiplied: the GPU blends neighbouring texels when it samples, and
// blending tissue with glass or a gap would otherwise darken the colour even
// though they add nothing to it.
function writeTissue(source: Uint8ClampedArray, target: Uint8Array, offset = 0): void {
	for (let i = 0; i < source.length; i += 4) {
		const alpha = tissueAlpha(source[i], source[i + 1], source[i + 2]);
		target[offset + i] = Math.round((source[i] * alpha) / 255);
		target[offset + i + 1] = Math.round((source[i + 1] * alpha) / 255);
		target[offset + i + 2] = Math.round((source[i + 2] * alpha) / 255);
		target[offset + i + 3] = alpha;
	}
}

// An empty block for these slices, each picture width x height, to be filled
// one slice at a time with addSlice - so the pictures needn't all be held at
// once while it's made.
function emptyVolume(width: number, height: number, slices: readonly Slice[]): Volume {
	if (slices.length === 0) throw new Error("no slices");
	const layerSlice = layerSlices(slices);
	return { rgba: new Uint8Array(width * height * 4 * layerSlice.length), width, height, depth: layerSlice.length, layerSlice };
}

function addSlice(volume: Volume, slice: number, image: SliceImage): void {
	if (image.width !== volume.width || image.height !== volume.height) {
		throw new Error(`slice pictures differ in size: ${image.width}x${image.height} and ${volume.width}x${volume.height}`);
	}
	const layer = volume.layerSlice.indexOf(slice);
	if (layer < 0) throw new Error(`no slice ${slice} in the block`);
	writeTissue(image.data, volume.rgba, layer * volume.width * volume.height * 4);
}

function buildVolume(images: readonly SliceImage[], slices: readonly Slice[]): Volume {
	if (images.length !== slices.length) throw new Error(`${images.length} pictures for ${slices.length} slices`);
	if (images.length === 0) throw new Error("no slices");
	const volume = emptyVolume(images[0].width, images[0].height, slices);
	slices.forEach((slice, i) => addSlice(volume, slice.index, images[i]));
	return volume;
}

// The sharp slice: the one being looked at, drawn from the slide's own tiles
// instead of the block. At most this many pixels - 64 MB as RGBA - which is
// 1/8 of Kartasalo's slides, about 3.7 um a pixel against the block's 15.
const DETAIL_PIXELS = 4096 * 4096;

interface DetailTier {
	z: number;
	cols: number;
	rows: number;
	downsample: number;
	// The tier's picture, in pixels.
	width: number;
	height: number;
}

// The sharpest tier of the slide's tiles that fits DETAIL_PIXELS and the
// GPU's biggest texture. The coarsest if none does.
function detailTier(slide: SlideInfo, maxSide: number, budget = DETAIL_PIXELS): DetailTier {
	const tiers = tiersOf(slide).map((tier) => ({
		...tier,
		width: Math.max(1, Math.floor(slide.width / tier.downsample)),
		height: Math.max(1, Math.floor(slide.height / tier.downsample)),
	}));
	for (let i = tiers.length - 1; i >= 0; i--) {
		const tier = tiers[i];
		if (tier.width * tier.height <= budget && tier.width <= maxSide && tier.height <= maxSide) return tier;
	}
	return tiers[0];
}

interface DetailView {
	layerSlice: readonly (number | null)[];
	// The slice the 2D view's on.
	current: number;
	firstLayer: number;
	lastLayer: number;
	spacing: number;
	cut: CutAxis;
	cutPosition: number;
	// Whether the camera's on the front's side of the block (layer 0's, +z).
	cameraInFront: boolean;
}

// Which slice gets drawn sharp. Spaced out, every slice can be seen, so it's
// the one the 2D view's on - the framed one, moved with the slice slider.
// Solid, only the block's face towards the camera can be: the first slice
// drawn from the front, the last from behind (or the face a Z cut leaves).
// Null if that's nothing drawn.
function detailSlice(view: DetailView): number | null {
	const { layerSlice, firstLayer, lastLayer } = view;
	const drawn = (layer: number) => layer >= firstLayer && layer <= lastLayer && layerSlice[layer] != null;
	if (view.spacing > 0) {
		const layer = layerSlice.indexOf(view.current);
		return layer >= 0 && drawn(layer) ? view.current : null;
	}
	let back = lastLayer;
	// A Z cut keeps the front of the block, up to the cut.
	if (view.cut === "z") back = Math.min(back, Math.ceil(Math.min(1, Math.max(0, view.cutPosition)) * layerSlice.length) - 1);
	if (back < firstLayer) return null;
	const towards = view.cameraInFront ? 1 : -1;
	// A gap layer has nothing to show, so the face is the next slice in.
	for (let layer = view.cameraInFront ? firstLayer : back; layer >= firstLayer && layer <= back; layer += towards) {
		if (drawn(layer)) return layerSlice[layer] ?? null;
	}
	return null;
}

// The sharp cut face. An X or Y cut shows the block's inside, which is only
// as fine as the block: 1024 px across Kartasalo's liver, 15 um a pixel. The
// face is one line of pixels from each slice - so it's sharpened from one
// column (X cut) or row (Y cut) of each slice's tiles, at the finest tier
// that keeps the tiles fetched under this many. 47 liver slices at 1/8 are
// 752 tiles, about 3.4 s from the tiler and 1.4 s once cached; the 260
// prostate slices get 1/32. A Z cut's face is a slice, sharpened by
// detailSlice; a diagonal one cuts across tiles, so it isn't.
const FACE_TILES = 1200;

type FaceAxis = "x" | "y";

function faceAxis(cut: CutAxis): FaceAxis | null {
	return cut === "x" || cut === "y" ? cut : null;
}

// How many pixels long the face is at this tier: down the slide for an X
// cut, across it for a Y cut.
function faceLength(tier: DetailTier, axis: FaceAxis): number {
	return axis === "x" ? tier.height : tier.width;
}

// The finest tier for the face of a cut along axis through this many slices,
// or null if none is finer than the block (blockLength pixels along the face)
// within FACE_TILES and the GPU's biggest texture.
function faceTier(
	slide: SlideInfo,
	axis: FaceAxis,
	slices: number,
	maxSide: number,
	blockLength: number,
	budget = FACE_TILES,
): DetailTier | null {
	const tiers = tiersOf(slide).map((tier) => ({
		...tier,
		width: Math.max(1, Math.floor(slide.width / tier.downsample)),
		height: Math.max(1, Math.floor(slide.height / tier.downsample)),
	}));
	for (let i = tiers.length - 1; i >= 0; i--) {
		const tier = tiers[i];
		const length = faceLength(tier, axis);
		if (length <= blockLength) return null;
		const tiles = (axis === "x" ? tier.rows : tier.cols) * slices;
		if (tiles <= budget && length <= maxSide) return tier;
	}
	return null;
}

// Which column (X cut) or row (Y cut) of the tier's pixels the face is, for
// a cut position (0-1, what's kept is below it). Null if the cut leaves nothing.
function facePixel(tier: DetailTier, axis: FaceAxis, position: number): number | null {
	if (position <= 0) return null;
	const across = axis === "x" ? tier.width : tier.height;
	return Math.min(across - 1, Math.floor(Math.min(1, position) * across));
}

interface FaceTile {
	z: number;
	x: number;
	y: number;
	// Where the tile's line goes along the face, in pixels.
	at: number;
	// Which column (X cut) or row (Y cut) of the tile is the face.
	pick: number;
}

// The tiles one slice's face line comes from, in order along it.
function faceTiles(tier: DetailTier, tileSize: number, axis: FaceAxis, pixel: number): FaceTile[] {
	const line = Math.floor(pixel / tileSize);
	const pick = pixel - line * tileSize;
	const count = axis === "x" ? tier.rows : tier.cols;
	return Array.from({ length: count }, (_, i) => ({
		z: tier.z,
		x: axis === "x" ? line : i,
		y: axis === "x" ? i : line,
		at: i * tileSize,
		pick,
	}));
}

// How wide each slice's picture should be for a volume of this many layers
// and this shape (height over width): BLOCK_WIDTH, or less to keep the block
// inside VOXEL_BUDGET.
function blockWidthFor(layers: number, aspect: number, budget = VOXEL_BUDGET): number {
	const fits = Math.floor(Math.sqrt(budget / (Math.max(1, layers) * Math.max(aspect, 1e-6))));
	return Math.max(MIN_BLOCK_WIDTH, Math.min(BLOCK_WIDTH, fits));
}

// The block's size in the scene, width 1. Height keeps the slide's shape.
// Depth is how thick the sections really are against how wide the slide is,
// times stretch, plus room for the gaps between slices when they're spaced
// out - so a slice stays as thick as it was.
function blockSize(
	slideWidth: number,
	slideHeight: number,
	layers: number,
	micronsPerPixel: number | null,
	stretch: number,
	sectionMicrons = ASSUMED_SECTION_MICRONS,
	spacing = 0,
): [number, number, number] {
	const trueDepth = micronsPerPixel ? (layers * sectionMicrons) / (slideWidth * micronsPerPixel) : layers / BLOCK_WIDTH;
	return [1, slideHeight / slideWidth, trueDepth * stretch * (1 + Math.max(0, spacing))];
}

// Spaced out, each layer is a slab in the middle of its share of the block's
// depth, and the rest of that share is empty. spacing is the gap against a
// slab's thickness: 0 is a solid block, 1 a gap as thick as a slice. Which
// layer's slab z (texture space, 0-1 through the block) is inside, or null in
// a gap. The shader does the same.
function slabAt(z: number, layers: number, spacing: number): number | null {
	const position = Math.min(Math.max(z, 0), 0.9999) * layers;
	const layer = Math.floor(position);
	if (spacing <= 0) return layer;
	const half = 0.5 / (1 + spacing);
	return Math.abs(position - layer - 0.5) <= half ? layer : null;
}

// The stretch that makes the block DEFAULT_STRETCH_OF_WIDTH as deep as it's wide.
function defaultStretch(slideWidth: number, layers: number, micronsPerPixel: number | null, sectionMicrons = ASSUMED_SECTION_MICRONS): number {
	const [, , trueDepth] = blockSize(slideWidth, 1, layers, micronsPerPixel, 1, sectionMicrons);
	return trueDepth > 0 ? DEFAULT_STRETCH_OF_WIDTH / trueDepth : 1;
}

// The stretch the block's drawn with. True depth is no stretch at all: 47
// liver sections at 5 um are 0.24 mm against 14.9 mm across, so it's a thin
// sheet - but a cut face is then the real shape, one section a line, where
// stretched each section's line is drawn many times wider than it is.
function depthStretch(trueDepth: boolean, defaultStretchScale: number, stretch: number): number {
	return trueDepth ? 1 : defaultStretchScale * stretch;
}

// What the panel shows for a gap: none, or how many slices thick it is.
function spacingText(spacing: number): string {
	if (spacing <= 0) return "None";
	return `${Number(spacing.toFixed(2))}x a slice`;
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
	// The gap between slices, as in slabAt. 0 when left out.
	spacing?: number;
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
	const spacing = Math.max(0, clip.spacing ?? 0);
	// Half a voxel along the finest axis at a time - and spaced out, half a
	// slab, which is thinner than a layer, so a slab can't be stepped over.
	const step = 0.5 / (1 + spacing) / Math.max(volume.width, volume.height, volume.depth) / length;
	for (let t = near; t <= far; t += step) {
		const p = [origin[0] + direction[0] * t, origin[1] + direction[1] * t, origin[2] + direction[2] * t];
		if (clip.normal[0] * p[0] + clip.normal[1] * p[1] + clip.normal[2] * p[2] > clip.offset) continue;
		const x = Math.min(volume.width - 1, Math.max(0, Math.floor(p[0] * volume.width)));
		const y = Math.min(volume.height - 1, Math.max(0, Math.floor(p[1] * volume.height)));
		const layer = slabAt(p[2], volume.depth, spacing);
		if (layer === null) continue;
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
	VOXEL_BUDGET,
	blockWidthFor,
	ASSUMED_SECTION_MICRONS,
	tissueAlpha,
	layerSlices,
	buildVolume,
	emptyVolume,
	addSlice,
	writeTissue,
	DETAIL_PIXELS,
	detailTier,
	detailSlice,
	FACE_TILES,
	faceAxis,
	faceLength,
	faceTier,
	facePixel,
	faceTiles,
	blockSize,
	slabAt,
	spacingText,
	defaultStretch,
	depthStretch,
	cutPlane,
	firstHit,
	textureRay,
	layerZ,
	thumbnailUrl,
};
export type { SliceImage, Volume, CutAxis, Clip, Vec3, DetailTier, DetailView, FaceAxis, FaceTile };
