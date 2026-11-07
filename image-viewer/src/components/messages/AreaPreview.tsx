import { useEffect, useRef } from "react";
import { useImageViewerContext } from "../../context/ImageViewerContext";
import { boundsOf, previewScale, previewSize, previewTiles, shapesOf, tileUrl, type SlideInfo } from "./previewTiles";
import type { ShownArea } from "./sentArea";

// Canvas pixels across - double what it's shown at, so it's sharp on any screen.
const PIXELS_WIDE = 400;

// Slides don't change while the viewer's open, and a chat may show dozens of these.
const slides = new Map<string, Promise<SlideInfo>>();

function slideInfo(url: string): Promise<SlideInfo> {
	let info = slides.get(url);
	if (!info) {
		info = fetch(url).then((response) => {
			if (!response.ok) throw new Error(String(response.status));
			return response.json() as Promise<SlideInfo>;
		});
		info.catch(() => slides.delete(url));
		slides.set(url, info);
	}
	return info;
}

interface AreaPreviewProps {
	area: ShownArea;
	slideId: string;
	label: string;
	// Not there for something from another slide, which can't be gone to.
	onOpen?: () => void;
}

// A small picture of something sent: that part of the slide with the shapes on
// it, turned the way it was seen. Tiles that don't arrive just leave a gap.
function AreaPreview({ area, slideId, label, onOpen }: AreaPreviewProps) {
	const { source } = useImageViewerContext();
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const size = previewSize(area.viewport, PIXELS_WIDE);

	useEffect(() => {
		const context = canvasRef.current?.getContext("2d");
		if (!context) return;
		let stopped = false;
		const { viewport, features } = area;
		const scale = previewScale(viewport, size);
		// An area's only shape is its own edge, which is the edge of the picture.
		const shapes = shapesOf(area.keepRotation ? [] : features);
		const drawn: { image: HTMLImageElement; left: number; top: number; downsample: number }[] = [];

		const draw = () => {
			context.setTransform(1, 0, 0, 1, 0, 0);
			context.fillStyle = "#000";
			context.fillRect(0, 0, size.width, size.height);
			context.translate(size.width / 2, size.height / 2);
			context.rotate(viewport.rotation);
			context.scale(scale, scale);
			context.translate(-viewport.center[0], viewport.center[1]);
			for (const { image, left, top, downsample } of drawn) {
				context.drawImage(image, left, top, image.naturalWidth * downsample, image.naturalHeight * downsample);
			}
			// In canvas pixels, which is double what it's shown at, so they stay
			// readable however far out the picture is.
			for (const { points, closed, colour, width, dashed } of shapes.paths) {
				context.beginPath();
				points.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)));
				if (closed) {
					context.closePath();
					context.globalAlpha = 0.2;
					context.fillStyle = colour;
					context.fill();
					context.globalAlpha = 1;
				}
				context.strokeStyle = colour;
				context.lineWidth = (width + 1) / scale;
				context.setLineDash(dashed ? [10 / scale, 7 / scale] : []);
				context.stroke();
			}
			context.setLineDash([]);
			context.lineWidth = 1 / scale;
			context.strokeStyle = "#000";
			for (const { x, y, colour } of shapes.dots) {
				context.beginPath();
				context.arc(x, y, 5 / scale, 0, 2 * Math.PI);
				context.fillStyle = colour;
				context.fill();
				context.stroke();
			}
		};

		draw();
		slideInfo(`${source.tilerUrl}/slides/${encodeURIComponent(slideId)}`)
			.then((slide) => {
				for (const tile of previewTiles(slide, boundsOf(viewport), PIXELS_WIDE)) {
					const image = new Image();
					image.onload = () => {
						if (stopped) return;
						drawn.push({ image, left: tile.left, top: tile.top, downsample: tile.downsample });
						draw();
					};
					image.src = tileUrl(source.tilerUrl, slideId, tile);
				}
			})
			.catch(() => {});
		return () => {
			stopped = true;
		};
		// size only follows from area, and is a new object each render.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [area, slideId, source.tilerUrl]);

	// Always the same element, even when it can't be pressed: swapping it would
	// make a new canvas, and nothing would draw on that.
	return (
		<button type="button" className="messages-preview" title={onOpen ? "Show this on the map" : undefined} disabled={!onOpen} onClick={onOpen}>
			<canvas ref={canvasRef} className="messages-preview-canvas" width={size.width} height={size.height} role="img" aria-label={label} />
		</button>
	);
}

export default AreaPreview;
