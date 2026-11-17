import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useSliceContext } from "../../context/SliceContext";
import { loadDetail, type Detail } from "./loadDetail";
import { loadFace, type Face } from "./loadFace";
import { loadVolume } from "./loadVolume";
import {
	ASSUMED_SECTION_MICRONS,
	blockSize,
	blockWidthFor,
	cutPlane,
	defaultStretch,
	depthStretch,
	detailSlice,
	faceAxis,
	facePixel,
	faceTier,
	firstHit,
	layerSlices,
	layerZ,
	textureRay,
	type Vec3,
	type Volume,
} from "./volume";
import { fragmentShader, vertexShader } from "./volumeShader";
import "./VolumeView.css";

interface VolumeViewProps {
	tilerUrl: string;
	slideId: string;
	// The slide's full size, and its pixel size if it has one.
	slideWidth: number;
	slideHeight: number;
	micronsPerPixel: number | null;
	// Its tiles' size - the sharp slice is made from them.
	tileSize: number;
}

// Where the camera starts - up and to the right, looking down at the front
// of the block, like DPLab's.
const START_POSITION = new THREE.Vector3(1.3, 1.05, 2.2);
// A click that moves less than this many pixels is a click, not a drag.
const CLICK_SLOP_PX = 5;
// How long the cut has to stay put before its face is sharpened, so dragging
// the slider doesn't start and drop a fetch for every step.
const FACE_SETTLE_MS = 250;

function cssColour(name: string, fallback: string): THREE.Color {
	const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	try {
		return new THREE.Color(value || fallback);
	} catch {
		return new THREE.Color(fallback);
	}
}

// Everything the scene holds, kept between renders.
interface Scene {
	renderer: THREE.WebGLRenderer;
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	controls: OrbitControls;
	block: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>;
	outline: THREE.LineSegments;
	grid: THREE.GridHelper;
	sliceFrame: THREE.LineLoop;
	texture: THREE.Data3DTexture;
	// The sharp slice's picture, once there is one.
	detail: THREE.DataTexture | null;
	// The sharp cut face's picture and which of its layers are in.
	face: { picture: THREE.DataTexture; ready: THREE.DataTexture } | null;
	render: () => void;
}

// The volume as a block in 3D: turn it round, zoom, pan, cut into it. Click
// the tissue to go to that slice and place in 2D. Drawn only when something
// changes, not every frame.
function VolumeView({ tilerUrl, slideId, slideWidth, slideHeight, micronsPerPixel, tileSize }: VolumeViewProps) {
	const { slices, current, settings, cameraReset, openInTwoD, sectionMicrons } = useSliceContext();
	const thickness = sectionMicrons ?? ASSUMED_SECTION_MICRONS;
	// Narrower pictures for a volume with many slices - see blockWidthFor.
	const pictureWidth = useMemo(() => blockWidthFor(layerSlices(slices).length, slideHeight / slideWidth), [slices, slideHeight, slideWidth]);
	const hostRef = useRef<HTMLDivElement | null>(null);
	const sceneRef = useRef<Scene | null>(null);
	const [volume, setVolume] = useState<Volume | null>(null);
	const [progress, setProgress] = useState({ done: 0, total: slices.length });
	const [error, setError] = useState<string | null>(null);
	// Which side of the block the camera's on, for which face gets the sharp slice.
	const [cameraInFront, setCameraInFront] = useState(START_POSITION.z >= 0);
	// The slice being made sharp, while it is.
	const [sharpening, setSharpening] = useState<number | null>(null);
	// The cut face's layers in so far, while it's being sharpened.
	const [faceProgress, setFaceProgress] = useState<{ done: number; total: number } | null>(null);
	// The GPU's biggest texture, once there's a GPU to ask.
	const [maxSide, setMaxSide] = useState<number | null>(null);

	// MapNode keys this by slide, so a new slide starts it from nothing.
	useEffect(() => {
		let cancelled = false;
		loadVolume(tilerUrl, slideId, slices, pictureWidth, (done, total) => {
			if (!cancelled) setProgress({ done, total });
		})
			.then((loadedVolume) => {
				if (!cancelled) setVolume(loadedVolume);
			})
			.catch((reason: unknown) => {
				if (!cancelled) setError(`Couldn't load the slices: ${reason instanceof Error ? reason.message : String(reason)}`);
			});
		return () => {
			cancelled = true;
		};
	}, [tilerUrl, slideId, slices, pictureWidth]);

	const stretchScale = useMemo(
		() => (volume ? defaultStretch(slideWidth, volume.depth, micronsPerPixel, thickness) : 1),
		[volume, slideWidth, micronsPerPixel, thickness],
	);
	const size = useMemo<Vec3>(
		() =>
			volume
				? blockSize(slideWidth, slideHeight, volume.depth, micronsPerPixel, depthStretch(settings.trueDepth, stretchScale, settings.stretch), thickness, settings.spacing)
				: [1, 1, 1],
		[volume, slideWidth, slideHeight, micronsPerPixel, stretchScale, settings.stretch, settings.trueDepth, thickness, settings.spacing],
	);

	// The scene, once the volume's in. Thrown away with the view, GL context and all.
	useEffect(() => {
		const host = hostRef.current;
		if (!host || !volume) return;

		const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.setClearColor(cssColour("--canvas-bg", "#202020"));
		host.appendChild(renderer.domElement);

		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
		camera.position.copy(START_POSITION);
		const controls = new OrbitControls(camera, renderer.domElement);
		controls.target.set(0, 0, 0);

		const texture = new THREE.Data3DTexture(volume.rgba, volume.width, volume.height, volume.depth);
		texture.format = THREE.RGBAFormat;
		texture.type = THREE.UnsignedByteType;
		texture.minFilter = THREE.LinearFilter;
		texture.magFilter = THREE.LinearFilter;
		texture.unpackAlignment = 1;
		texture.needsUpdate = true;

		const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1);
		blank.needsUpdate = true;
		const material = new THREE.ShaderMaterial({
			glslVersion: THREE.GLSL3,
			vertexShader,
			fragmentShader,
			side: THREE.BackSide,
			transparent: true,
			depthWrite: false,
			uniforms: {
				uVolume: { value: texture },
				uCamera: { value: new THREE.Vector3() },
				uSize: { value: new THREE.Vector3(1, 1, 1) },
				uLayers: { value: volume.depth },
				uFirstLayer: { value: 0 },
				uLastLayer: { value: volume.depth - 1 },
				uCutNormal: { value: new THREE.Vector3() },
				uCutOffset: { value: 1 },
				uOpacity: { value: 1 },
				uStep: { value: 1 / 600 },
				uVoxel: { value: 1 / volume.width },
				uSpacing: { value: 0 },
				// Nothing sharp yet - a blank stand-in so the sampler always has something.
				uDetail: { value: blank },
				uDetailLayer: { value: -1 },
				uDetailWidth: { value: 1 },
				uPixelAngle: { value: 0.001 },
				uFace: { value: blank },
				uFaceReady: { value: blank },
				uFaceAxis: { value: -1 },
				uFaceLength: { value: 1 },
			},
		});
		const block = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
		scene.add(block);

		const lineColour = cssColour("--chrome-text-secondary", "#9a9a9a");
		const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: lineColour }));
		scene.add(outline);
		const grid = new THREE.GridHelper(2, 20, lineColour, lineColour);
		(grid.material as THREE.Material).opacity = 0.25;
		(grid.material as THREE.Material).transparent = true;
		scene.add(grid);
		// The slice the 2D view's on, as a frame round the block at its depth.
		const sliceFrame = new THREE.LineLoop(
			new THREE.BufferGeometry().setFromPoints([
				new THREE.Vector3(-0.5, -0.5, 0),
				new THREE.Vector3(0.5, -0.5, 0),
				new THREE.Vector3(0.5, 0.5, 0),
				new THREE.Vector3(-0.5, 0.5, 0),
			]),
			new THREE.LineBasicMaterial({ color: cssColour("--accent", "#3fb6a8") }),
		);
		scene.add(sliceFrame);

		const render = () => {
			// The shader wants the camera in the block's own space - it's at the
			// origin, unrotated, so that's the scene's.
			material.uniforms.uCamera.value.copy(camera.position);
			renderer.render(scene, camera);
		};
		controls.addEventListener("change", () => setCameraInFront(camera.position.z >= 0));
		controls.addEventListener("change", render);

		const resize = () => {
			const { clientWidth, clientHeight } = host;
			if (clientWidth === 0 || clientHeight === 0) return;
			renderer.setSize(clientWidth, clientHeight, false);
			camera.aspect = clientWidth / clientHeight;
			camera.updateProjectionMatrix();
			material.uniforms.uPixelAngle.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / renderer.domElement.height;
			render();
		};
		const observer = new ResizeObserver(resize);
		observer.observe(host);
		resize();

		sceneRef.current = { renderer, scene, camera, controls, block, outline, grid, sliceFrame, texture, detail: null, face: null, render };
		setMaxSide(renderer.capabilities.maxTextureSize);
		// For looking into it from the console, like window.viewerMap. Dev server only.
		if (import.meta.env.DEV) Object.assign(window, { viewerVolume: { volume, scene: sceneRef.current } });
		return () => {
			observer.disconnect();
			controls.dispose();
			block.geometry.dispose();
			material.dispose();
			texture.dispose();
			blank.dispose();
			sceneRef.current?.detail?.dispose();
			sceneRef.current?.face?.picture.dispose();
			sceneRef.current?.face?.ready.dispose();
			outline.geometry.dispose();
			(outline.material as THREE.Material).dispose();
			grid.geometry.dispose();
			(grid.material as THREE.Material).dispose();
			sliceFrame.geometry.dispose();
			(sliceFrame.material as THREE.Material).dispose();
			renderer.dispose();
			// Browsers allow about 16 GL contexts, and the 2D map still has its own.
			renderer.forceContextLoss();
			renderer.domElement.remove();
			sceneRef.current = null;
		};
	}, [volume]);

	// The block's size, the cut, the layers drawn, opacity, guides and the
	// slice frame - all cheap, no rebuild.
	useEffect(() => {
		const scene = sceneRef.current;
		if (!scene || !volume) return;
		const { block, outline, grid, sliceFrame } = scene;
		block.scale.set(...size);
		outline.scale.set(...size);
		grid.position.y = -size[1] / 2 - 0.02;
		const uniforms = block.material.uniforms;
		uniforms.uSize.value.set(...size);
		const plane = cutPlane(settings.cut, settings.cutPosition);
		uniforms.uCutNormal.value.set(...plane.normal);
		uniforms.uCutOffset.value = plane.offset;
		uniforms.uOpacity.value = settings.opacity;
		uniforms.uSpacing.value = settings.spacing;
		const firstLayer = volume.layerSlice.indexOf(settings.firstSlice);
		const lastLayer = volume.layerSlice.indexOf(settings.lastSlice);
		uniforms.uFirstLayer.value = Math.max(0, firstLayer);
		uniforms.uLastLayer.value = lastLayer < 0 ? volume.depth - 1 : lastLayer;
		outline.visible = settings.guides;
		grid.visible = settings.guides;
		const currentLayer = volume.layerSlice.indexOf(current);
		sliceFrame.visible = currentLayer >= 0;
		sliceFrame.scale.set(size[0], size[1], 1);
		sliceFrame.position.z = layerZ(currentLayer, volume.depth, size[2]);
		scene.render();
	}, [volume, size, settings, current]);

	// Which slice is drawn sharp - see detailSlice.
	const wantedDetail = useMemo(() => {
		if (!volume) return null;
		const firstLayer = volume.layerSlice.indexOf(settings.firstSlice);
		const lastLayer = volume.layerSlice.indexOf(settings.lastSlice);
		return detailSlice({
			layerSlice: volume.layerSlice,
			current,
			firstLayer: Math.max(0, firstLayer),
			lastLayer: lastLayer < 0 ? volume.depth - 1 : lastLayer,
			spacing: settings.spacing,
			cut: settings.cut,
			cutPosition: settings.cutPosition,
			cameraInFront,
		});
	}, [volume, current, settings.firstSlice, settings.lastSlice, settings.spacing, settings.cut, settings.cutPosition, cameraInFront]);

	// Fetches it and swaps it in. Until it's there, the last one stays on its
	// own layer - still right there - and the rest is the block.
	useEffect(() => {
		const scene = sceneRef.current;
		if (!scene || !volume || wantedDetail === null) return;
		const slide = { width: slideWidth, height: slideHeight, tileSize };
		const job = loadDetail(tilerUrl, slideId, wantedDetail, slide, scene.renderer.capabilities.maxTextureSize);
		let live = true;
		const show = (detail: Detail) => {
			const current = sceneRef.current;
			if (!live || !current) return;
			const texture = new THREE.DataTexture(detail.rgba, detail.width, detail.height, THREE.RGBAFormat, THREE.UnsignedByteType);
			texture.generateMipmaps = true;
			texture.minFilter = THREE.LinearMipmapLinearFilter;
			texture.magFilter = THREE.LinearFilter;
			texture.unpackAlignment = 1;
			texture.needsUpdate = true;
			current.detail?.dispose();
			current.detail = texture;
			const uniforms = current.block.material.uniforms;
			uniforms.uDetail.value = texture;
			uniforms.uDetailLayer.value = volume.layerSlice.indexOf(detail.slice);
			uniforms.uDetailWidth.value = detail.width;
			current.render();
		};
		setSharpening(wantedDetail);
		job.detail
			.then(show)
			// The block's still there - a slice that won't sharpen isn't worth more than a console line.
			.catch((reason: unknown) => {
				if (live && !(reason instanceof DOMException && reason.name === "AbortError")) console.warn("sharp slice", reason);
			})
			.finally(() => {
				if (live) setSharpening(null);
			});
		return () => {
			live = false;
			job.cancel();
		};
	}, [volume, wantedDetail, tilerUrl, slideId, slideWidth, slideHeight, tileSize]);

	// The sharp cut face - see faceTier. Which tier depends on the cut and the
	// volume; which line of it on where the cut is, so the slider only starts
	// a fetch when it moves onto another line.
	const cutFaceAxis = faceAxis(settings.cut);
	const cutFaceTier = useMemo(() => {
		if (!volume || !cutFaceAxis || maxSide === null) return null;
		const slices = volume.layerSlice.filter((slice) => slice !== null).length;
		const blockLength = cutFaceAxis === "x" ? volume.height : volume.width;
		return faceTier({ width: slideWidth, height: slideHeight, tileSize }, cutFaceAxis, slices, maxSide, blockLength);
	}, [volume, cutFaceAxis, maxSide, slideWidth, slideHeight, tileSize]);
	const cutFacePixel = cutFaceTier && cutFaceAxis ? facePixel(cutFaceTier, cutFaceAxis, settings.cutPosition) : null;

	useEffect(() => {
		const scene = sceneRef.current;
		if (!scene || !volume) return;
		// Whatever face is up is for another cut now.
		const uniforms = scene.block.material.uniforms;
		uniforms.uFaceAxis.value = -1;
		scene.render();
		if (!cutFaceTier || !cutFaceAxis || cutFacePixel === null) return;
		let live = true;
		let job: { face: Promise<Face>; cancel: () => void } | null = null;
		let frame = 0;
		// Up to the GPU as each layer comes in - one upload a frame at most.
		const show = (face: Face) => {
			const current = sceneRef.current;
			if (!live || !current) return;
			if (current.face?.picture.image.data !== face.rgba) {
				current.face?.picture.dispose();
				current.face?.ready.dispose();
				const picture = new THREE.DataTexture(face.rgba, face.length, face.layers, THREE.RGBAFormat, THREE.UnsignedByteType);
				picture.minFilter = THREE.LinearFilter;
				picture.magFilter = THREE.LinearFilter;
				const ready = new THREE.DataTexture(face.ready, 1, face.layers, THREE.RGBAFormat, THREE.UnsignedByteType);
				ready.minFilter = THREE.LinearFilter;
				ready.magFilter = THREE.LinearFilter;
				current.face = { picture, ready };
				uniforms.uFace.value = picture;
				uniforms.uFaceReady.value = ready;
				uniforms.uFaceLength.value = face.length;
			}
			current.face.picture.needsUpdate = true;
			current.face.ready.needsUpdate = true;
			uniforms.uFaceAxis.value = face.axis === "x" ? 0 : 1;
			current.render();
		};
		const settle = window.setTimeout(() => {
			job = loadFace(tilerUrl, slideId, volume.layerSlice, cutFaceTier, tileSize, cutFaceAxis, cutFacePixel, (face, done, total) => {
				if (!live) return;
				setFaceProgress({ done, total });
				cancelAnimationFrame(frame);
				frame = requestAnimationFrame(() => show(face));
			});
			job.face
				.then((face) => {
					cancelAnimationFrame(frame);
					show(face);
				})
				.catch((reason: unknown) => {
					if (live && !(reason instanceof DOMException && reason.name === "AbortError")) console.warn("sharp cut", reason);
				})
				.finally(() => {
					if (live) setFaceProgress(null);
				});
		}, FACE_SETTLE_MS);
		return () => {
			live = false;
			window.clearTimeout(settle);
			cancelAnimationFrame(frame);
			job?.cancel();
			setFaceProgress(null);
		};
	}, [volume, cutFaceTier, cutFaceAxis, cutFacePixel, tilerUrl, slideId, tileSize]);

	// Back to the start.
	useEffect(() => {
		const scene = sceneRef.current;
		if (!scene || cameraReset === 0) return;
		scene.camera.position.copy(START_POSITION);
		scene.controls.target.set(0, 0, 0);
		scene.controls.update();
		scene.render();
	}, [cameraReset]);

	// A click (not a drag) on the tissue opens that slice and place in 2D.
	useEffect(() => {
		const scene = sceneRef.current;
		if (!scene || !volume) return;
		const canvas = scene.renderer.domElement;
		let down: { x: number; y: number } | null = null;
		const onDown = (event: PointerEvent) => {
			down = { x: event.clientX, y: event.clientY };
		};
		const onUp = (event: PointerEvent) => {
			const start = down;
			down = null;
			if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP_PX) return;
			const rect = canvas.getBoundingClientRect();
			const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
			const raycaster = new THREE.Raycaster();
			raycaster.setFromCamera(pointer, scene.camera);
			const { origin, direction } = raycaster.ray;
			const ray = textureRay([origin.x, origin.y, origin.z], [direction.x, direction.y, direction.z], size);
			const plane = cutPlane(settings.cut, settings.cutPosition);
			const uniforms = scene.block.material.uniforms;
			const hit = firstHit(volume, ray.origin, ray.direction, {
				...plane,
				firstLayer: uniforms.uFirstLayer.value as number,
				lastLayer: uniforms.uLastLayer.value as number,
				spacing: settings.spacing,
			});
			if (!hit) return;
			const slice = volume.layerSlice[hit.layer];
			if (slice === null) return;
			openInTwoD(slice, hit.x * slideWidth, hit.y * slideHeight);
		};
		canvas.addEventListener("pointerdown", onDown);
		canvas.addEventListener("pointerup", onUp);
		return () => {
			canvas.removeEventListener("pointerdown", onDown);
			canvas.removeEventListener("pointerup", onUp);
		};
	}, [volume, size, settings.cut, settings.cutPosition, settings.spacing, slideWidth, slideHeight, openInTwoD]);

	return (
		<div className="volume-view" ref={hostRef}>
			{!volume && !error && (
				<div className="volume-view-status">
					Loading slices {progress.done} of {progress.total}
				</div>
			)}
			{error && <div className="volume-view-status">{error}</div>}
			{volume && (sharpening !== null || faceProgress) && (
				<div className="volume-view-sharpening">
					{[
						sharpening !== null && `Sharpening slice ${sharpening + 1}`,
						faceProgress && `Sharpening the cut, ${faceProgress.done} of ${faceProgress.total} slices`,
					]
						.filter(Boolean)
						.join(" - ")}
				</div>
			)}
		</div>
	);
}

export default VolumeView;
