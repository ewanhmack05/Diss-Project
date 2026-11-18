// Other people in the 3D view: their cameras, their 2D view boxes and their
// cuts, worked out in the block's space so the view only has to draw lines.
// See docs/volume-live.md, phase 3.

import { cutPlane, layerZ, type CutAxis, type Vec3 } from "./volume";
import { viewportRing, type Camera, type Participant, type Viewport } from "../realtime/realtime";

// The scene is the block centred on the origin, size big. Block units are
// each axis as a fraction of the block - so a camera means the same place
// against the block whoever's drawing it, however deep they've stretched it.
function toBlock(world: Vec3, size: Vec3): Vec3 {
	return [world[0] / size[0], world[1] / size[1], world[2] / size[2]];
}

function fromBlock(block: Vec3, size: Vec3): Vec3 {
	return [block[0] * size[0], block[1] * size[1], block[2] * size[2]];
}

function cameraToBlock(position: Vec3, target: Vec3, fov: number, size: Vec3): Camera {
	return { position: toBlock(position, size), target: toBlock(target, size), fov };
}

function cameraFromBlock(camera: Camera, size: Vec3): { position: Vec3; target: Vec3 } {
	return { position: fromBlock(camera.position, size), target: fromBlock(camera.target, size) };
}

// Close enough to be the same camera - so a resend of where someone already
// is doesn't count as them moving.
function sameCamera(a: Camera | null | undefined, b: Camera | null | undefined, within = 1e-4): boolean {
	if (!a || !b) return a === b;
	const near = (x: Vec3, y: Vec3) => x.every((value, i) => Math.abs(value - y[i]) <= within);
	return near(a.position, b.position) && near(a.target, b.target) && Math.abs(a.fov - b.fov) <= within;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
	const l = length(a);
	return l === 0 ? [0, 0, 0] : scale(a, 1 / l);
};

// Screens differ, so others' frustums are drawn at a typical one.
const FRUSTUM_ASPECT = 16 / 10;

// A small pyramid for a camera, in world space: its point at the camera, its
// base `size` along where it's looking, shaped by its field of view. As
// pairs of points for line segments - four edges out from the point, then
// the base. Up is the scene's up, as the 3D view's controls keep it; looking
// straight up or down, its right is the scene's x.
function frustumLines(position: Vec3, target: Vec3, fov: number, size: number, aspect = FRUSTUM_ASPECT): Vec3[] {
	const forward = unit(sub(target, position));
	let right = cross(forward, [0, 1, 0]);
	right = length(right) < 1e-6 ? [1, 0, 0] : unit(right);
	const up = unit(cross(right, forward));
	const halfHeight = Math.tan(((fov * Math.PI) / 180) / 2) * size;
	const halfWidth = halfHeight * aspect;
	const middle = add(position, scale(forward, size));
	const corner = (x: number, y: number) => add(middle, add(scale(right, x * halfWidth), scale(up, y * halfHeight)));
	const corners = [corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)];
	const lines: Vec3[] = [];
	for (const c of corners) lines.push(position, c);
	for (let i = 0; i < 4; i++) lines.push(corners[i], corners[(i + 1) % 4]);
	return lines;
}

interface SlideShape {
	width: number;
	height: number;
}

// A 2D view box, laid on its slice in the block. The map's coordinates are
// slide pixels with y going up from the top edge (y is minus the pixel row).
// layer is the slice's layer in the block, layers how many there are.
function viewBoxInBlock(viewport: Viewport, slide: SlideShape, size: Vec3, layer: number, layers: number): Vec3[] {
	const z = layerZ(layer, layers, size[2]);
	return viewportRing(viewport).map(([x, y]): Vec3 => [(x / slide.width - 0.5) * size[0], (0.5 - -y / slide.height) * size[1], z]);
}

// Texture space (each axis 0-1, y down the slide, layer 0 at the front) back
// to the scene. The same flips as textureRay, the other way.
function textureToWorld(p: Vec3, size: Vec3): Vec3 {
	return [(p[0] - 0.5) * size[0], (0.5 - p[1]) * size[1], (0.5 - p[2]) * size[2]];
}

const CUBE_EDGES: [Vec3, Vec3][] = (() => {
	const edges: [Vec3, Vec3][] = [];
	for (const a of [0, 1])
		for (const b of [0, 1]) {
			edges.push([[0, a, b], [1, a, b]]);
			edges.push([[a, 0, b], [a, 1, b]]);
			edges.push([[a, b, 0], [a, b, 1]]);
		}
	return edges;
})();

// Where someone's cut crosses the block, as a closed outline in the scene -
// empty with no cut, or one that misses the block. The plane against each of
// the cube's twelve edges, then the points in order round their middle.
function cutOutline(cut: CutAxis, position: number, size: Vec3): Vec3[] {
	if (cut === "none") return [];
	const { normal, offset } = cutPlane(cut, position);
	const dot = (p: Vec3) => normal[0] * p[0] + normal[1] * p[1] + normal[2] * p[2];
	const points: Vec3[] = [];
	for (const [a, b] of CUBE_EDGES) {
		const da = dot(a) - offset;
		const db = dot(b) - offset;
		if ((da > 0 && db > 0) || (da < 0 && db < 0) || da === db) continue;
		const t = da / (da - db);
		const p = add(a, scale(sub(b, a), t));
		if (!points.some((q) => length(sub(p, q)) < 1e-9)) points.push(p);
	}
	if (points.length < 3) return [];
	const middle = scale(points.reduce(add, [0, 0, 0] as Vec3), 1 / points.length);
	// Round the plane: two directions in it, then each point's angle.
	const u = unit(sub(points[0], middle));
	const v = cross(unit(normal), u);
	const angle = (p: Vec3) => {
		const d = sub(p, middle);
		return Math.atan2(d[0] * v[0] + d[1] * v[1] + d[2] * v[2], d[0] * u[0] + d[1] * u[1] + d[2] * u[2]);
	};
	const ordered = [...points].sort((a, b) => angle(a) - angle(b)).map((p) => textureToWorld(p, size));
	return [...ordered, ordered[0]];
}

// Past this many cameras the block's crowded - then only the host's and
// whoever's moved lately are drawn, like viewport boxes in a large session.
const MOST_CAMERAS = 6;
const RECENT_MS = 60_000;

// Who gets a camera drawn: everyone up to MOST_CAMERAS, otherwise the host
// and anyone whose camera moved in the last RECENT_MS. movedAt is when each
// connection's camera last changed.
function camerasToDraw<T extends Pick<Participant, "connectionId" | "host">>(
	people: T[],
	movedAt: ReadonlyMap<string, number>,
	now: number,
	most = MOST_CAMERAS,
	recent = RECENT_MS,
): T[] {
	if (people.length <= most) return people;
	return people.filter((p) => p.host || now - (movedAt.get(p.connectionId) ?? 0) <= recent);
}

// Following someone's camera, yours closes half the gap to theirs every
// EASE_HALF_LIFE_MS - updates come ten a second at most, and jumping to each
// looks jerky in 3D, where a small turn moves everything on screen.
const EASE_HALF_LIFE_MS = 60;
// Close enough to stop easing and land on it, in world units (the block is 1 wide).
const EASE_DONE = 1e-4;

interface Pose {
	position: Vec3;
	target: Vec3;
}

// One frame of easing: dt since the last. done once both points are within
// EASE_DONE, when it lands exactly on the goal.
function easeCamera(now: Pose, goal: Pose, dt: number, halfLife = EASE_HALF_LIFE_MS): Pose & { done: boolean } {
	const gap = Math.max(length(sub(goal.position, now.position)), length(sub(goal.target, now.target)));
	if (gap <= EASE_DONE) return { ...goal, done: true };
	const keep = Math.pow(0.5, Math.max(0, dt) / halfLife);
	const toward = (from: Vec3, to: Vec3) => add(to, scale(sub(from, to), keep));
	return { position: toward(now.position, goal.position), target: toward(now.target, goal.target), done: false };
}

// How long easing takes to land from a gap this big, in ms - for the docs'
// sums and the tests. Frames make it a little longer in practice.
function easeTime(gap: number, halfLife = EASE_HALF_LIFE_MS): number {
	return gap <= EASE_DONE ? 0 : halfLife * Math.log2(gap / EASE_DONE);
}

// A camera that's been still this long is drawn faded.
const STILL_MS = 30_000;

function isStill(movedAt: number | undefined, now: number, still = STILL_MS): boolean {
	return movedAt === undefined || now - movedAt > still;
}

export {
	EASE_HALF_LIFE_MS,
	easeCamera,
	easeTime,
	MOST_CAMERAS,
	STILL_MS,
	toBlock,
	fromBlock,
	cameraToBlock,
	cameraFromBlock,
	sameCamera,
	frustumLines,
	viewBoxInBlock,
	textureToWorld,
	cutOutline,
	camerasToDraw,
	isStill,
};
export type { SlideShape, Pose };
