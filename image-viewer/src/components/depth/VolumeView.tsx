import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useSliceContext } from "../../context/SliceContext";
import { loadVolume } from "./loadVolume";
import { blockSize, cutPlane, defaultStretch, firstHit, layerZ, textureRay, type Vec3, type Volume } from "./volume";
import { fragmentShader, vertexShader } from "./volumeShader";
import "./VolumeView.css";

interface VolumeViewProps {
	tilerUrl: string;
	slideId: string;
	// The slide's full size, and its pixel size if it has one.
	slideWidth: number;
	slideHeight: number;
	micronsPerPixel: number | null;
}

// Where the camera starts - up and to the right, looking down at the front
// of the block, like DPLab's.
const START_POSITION = new THREE.Vector3(1.3, 1.05, 2.2);
// A click that moves less than this many pixels is a click, not a drag.
const CLICK_SLOP_PX = 5;

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
	render: () => void;
}

// The volume as a block in 3D: turn it round, zoom, pan, cut into it. Click
// the tissue to go to that slice and place in 2D. Drawn only when something
// changes, not every frame.
function VolumeView({ tilerUrl, slideId, slideWidth, slideHeight, micronsPerPixel }: VolumeViewProps) {
	const { slices, current, settings, cameraReset, openInTwoD } = useSliceContext();
	const hostRef = useRef<HTMLDivElement | null>(null);
	const sceneRef = useRef<Scene | null>(null);
	const [volume, setVolume] = useState<Volume | null>(null);
	const [progress, setProgress] = useState({ done: 0, total: slices.length });
	const [error, setError] = useState<string | null>(null);

	// MapNode keys this by slide, so a new slide starts it from nothing.
	useEffect(() => {
		let cancelled = false;
		loadVolume(tilerUrl, slideId, slices, (done, total) => {
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
	}, [tilerUrl, slideId, slices]);

	const stretchScale = useMemo(
		() => (volume ? defaultStretch(slideWidth, volume.depth, micronsPerPixel) : 1),
		[volume, slideWidth, micronsPerPixel],
	);
	const size = useMemo<Vec3>(
		() => (volume ? blockSize(slideWidth, slideHeight, volume.depth, micronsPerPixel, stretchScale * settings.stretch) : [1, 1, 1]),
		[volume, slideWidth, slideHeight, micronsPerPixel, stretchScale, settings.stretch],
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
		controls.addEventListener("change", render);

		const resize = () => {
			const { clientWidth, clientHeight } = host;
			if (clientWidth === 0 || clientHeight === 0) return;
			renderer.setSize(clientWidth, clientHeight, false);
			camera.aspect = clientWidth / clientHeight;
			camera.updateProjectionMatrix();
			render();
		};
		const observer = new ResizeObserver(resize);
		observer.observe(host);
		resize();

		sceneRef.current = { renderer, scene, camera, controls, block, outline, grid, sliceFrame, texture, render };
		// For looking into it from the console, like window.viewerMap. Dev server only.
		if (import.meta.env.DEV) Object.assign(window, { viewerVolume: { volume, scene: sceneRef.current } });
		return () => {
			observer.disconnect();
			controls.dispose();
			block.geometry.dispose();
			material.dispose();
			texture.dispose();
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
	}, [volume, size, settings.cut, settings.cutPosition, slideWidth, slideHeight, openInTwoD]);

	return (
		<div className="volume-view" ref={hostRef}>
			{!volume && !error && (
				<div className="volume-view-status">
					Loading slices {progress.done} of {progress.total}
				</div>
			)}
			{error && <div className="volume-view-status">{error}</div>}
		</div>
	);
}

export default VolumeView;
