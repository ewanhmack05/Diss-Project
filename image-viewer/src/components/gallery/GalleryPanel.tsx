import { useEffect, useRef, useState } from "react";
import { useImageViewerContext } from "../../context/ImageViewerContext";
import type { DockSide } from "../toolbar/dock";
import Icon from "../../icons/Icon";
import gallerySvg from "../../icons/gallery.svg?raw";
import stripSvg from "../../icons/strip.svg?raw";
import chevronLeftSvg from "../../icons/chevron-left.svg?raw";
import chevronRightSvg from "../../icons/chevron-right.svg?raw";
import chevronUpSvg from "../../icons/chevron-up.svg?raw";
import chevronDownSvg from "../../icons/chevron-down.svg?raw";
import { useGallery, type Gallery } from "./useGallery";
import {
	collectionsText,
	fileText,
	galleryLayout,
	kindText,
	liveText,
	neighbour,
	peopleText,
	physicalText,
	pixelsText,
	positionText,
	scannerText,
	slideName,
	thumbnailUrl,
	wholeSlideTileUrl,
	zoomText,
	type GallerySlide,
} from "./slides";
import "./GalleryPanel.css";

interface GalleryPanelProps {
	storeUrl: string;
	// Where it's docked, if it is - that decides the layout.
	dockedSide: DockSide | null;
}

// The slide's picture, on its own background colour so a thin portrait slide
// sits in its box rather than stretching to it. Falls back to the one tile
// that's the whole slide if the tiler can't make a thumbnail.
function Thumbnail({ tilerUrl, slide }: { tilerUrl: string; slide: GallerySlide }) {
	const [fallback, setFallback] = useState(false);
	return (
		<span className="gallery-thumb" style={slide.backgroundColour ? { background: slide.backgroundColour } : undefined}>
			<img
				src={fallback ? wholeSlideTileUrl(tilerUrl, slide.id) : thumbnailUrl(tilerUrl, slide.id)}
				alt=""
				loading="lazy"
				draggable={false}
				onError={() => setFallback(true)}
			/>
		</span>
	);
}

interface ItemProps {
	slide: GallerySlide;
	current: boolean;
	gallery: Gallery;
	onOpen: (slide: GallerySlide) => void;
}

function Card({ slide, current, gallery, onOpen }: ItemProps) {
	const { source } = useImageViewerContext();
	const summary = gallery.summaries.get(slide.id);
	const lines = [pixelsText(slide), zoomText(slide), physicalText(slide), kindText(slide), fileText(slide)].filter(Boolean);
	const live = liveText(summary);
	const people = peopleText(gallery.people.get(slide.id) ?? 0);
	return (
		<li>
			<button
				type="button"
				className={`gallery-card${current ? " gallery-card--current" : ""}`}
				aria-current={current ? "true" : undefined}
				title={scannerText(slide) ?? undefined}
				onClick={() => onOpen(slide)}
			>
				<Thumbnail tilerUrl={source.tilerUrl} slide={slide} />
				<span className="gallery-card-about">
					<span className="gallery-card-name">{slideName(slide)}</span>
					{slideName(slide) !== slide.id && <span className="gallery-card-id">{slide.id}</span>}
					{lines.map((line) => (
						<span key={line} className="gallery-card-line">
							{line}
						</span>
					))}
					<span className="gallery-card-line gallery-card-line--work">
						{gallery.summaryFailed ? "Couldn't load collections" : collectionsText(summary)}
					</span>
					{live && <span className="gallery-card-line gallery-card-line--live">{live}</span>}
					{people && <span className="gallery-card-line gallery-card-line--live">{people}</span>}
					{current && <span className="gallery-card-line gallery-card-line--current">Open now</span>}
				</span>
			</button>
		</li>
	);
}

function Tile({ slide, current, gallery, onOpen }: ItemProps) {
	const { source } = useImageViewerContext();
	const live = (gallery.summaries.get(slide.id)?.liveSessions ?? 0) > 0 || (gallery.people.get(slide.id) ?? 0) > 0;
	const name = slideName(slide);
	return (
		<li>
			<button
				type="button"
				className={`gallery-tile${current ? " gallery-tile--current" : ""}${live ? " gallery-tile--live" : ""}`}
				aria-current={current ? "true" : undefined}
				aria-label={current ? `${name}, open now` : `Open ${name}`}
				title={[name, pixelsText(slide), zoomText(slide)].filter(Boolean).join("\n")}
				onClick={() => onOpen(slide)}
			>
				<Thumbnail tilerUrl={source.tilerUrl} slide={slide} />
				<span className="gallery-tile-name">{name}</span>
			</button>
		</li>
	);
}

// Every slide the tiler has, to move between. Floating it's cards with
// everything about each slide, or a strip of pictures - the button at the top
// switches. Docked it's always a strip, running the way the edge does, with
// the arrows on a ribbon over the bottom of it.
function GalleryPanel({ storeUrl, dockedSide }: GalleryPanelProps) {
	const { source, moveToSlide } = useImageViewerContext();
	const gallery = useGallery(storeUrl);
	const [expanded, setExpanded] = useState(true);
	const layout = galleryLayout(dockedSide, expanded);
	const listRef = useRef<HTMLUListElement>(null);
	const current = source.slideId;

	// The open one stays in sight - after a move, and when the layout changes.
	useEffect(() => {
		listRef.current?.querySelector<HTMLElement>("[aria-current]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [current, layout, gallery.slides]);

	const open = (slide: GallerySlide) => {
		if (slide.id !== current) void moveToSlide(slide.id);
	};
	const previous = neighbour(gallery.slides, current, -1);
	const next = neighbour(gallery.slides, current, 1);
	const vertical = layout === "strip-vertical";

	const body = () => {
		if (gallery.status === "loading") return <p className="gallery-note">Loading slides…</p>;
		if (gallery.status === "error") return <p className="gallery-note">Couldn't reach the tile server for the list of slides.</p>;
		if (gallery.slides.length === 0) return <p className="gallery-note">The tile server has no slides.</p>;
		if (layout === "cards") {
			return (
				<ul ref={listRef} className="gallery-cards">
					{gallery.slides.map((slide) => (
						<Card key={slide.id} slide={slide} current={slide.id === current} gallery={gallery} onOpen={open} />
					))}
				</ul>
			);
		}
		return (
			<div className={`gallery-strip gallery-strip--${vertical ? "vertical" : "horizontal"}`}>
				<ul ref={listRef} className="gallery-strip-list">
					{gallery.slides.map((slide) => (
						<Tile key={slide.id} slide={slide} current={slide.id === current} gallery={gallery} onOpen={open} />
					))}
				</ul>
				<div className="gallery-ribbon">
					<button
						type="button"
						className="gallery-ribbon-button"
						disabled={!previous}
						aria-label={previous ? `Previous slide, ${slideName(previous)}` : "Previous slide"}
						onClick={() => previous && open(previous)}
					>
						<Icon svg={vertical ? chevronUpSvg : chevronLeftSvg} size={14} />
					</button>
					<span className="gallery-ribbon-text">{positionText(gallery.slides, current)}</span>
					<button
						type="button"
						className="gallery-ribbon-button"
						disabled={!next}
						aria-label={next ? `Next slide, ${slideName(next)}` : "Next slide"}
						onClick={() => next && open(next)}
					>
						<Icon svg={vertical ? chevronDownSvg : chevronRightSvg} size={14} />
					</button>
				</div>
			</div>
		);
	};

	return (
		<div className={`gallery gallery--${layout}${dockedSide ? " gallery--docked" : ""}`}>
			{!dockedSide && (
				<div className="gallery-bar">
					<span className="gallery-bar-text">{gallery.status === "ready" ? positionText(gallery.slides, current) : ""}</span>
					<button type="button" className="gallery-bar-button" aria-pressed={!expanded} onClick={() => setExpanded((now) => !now)}>
						<Icon svg={expanded ? stripSvg : gallerySvg} size={14} />
						{expanded ? "Filmstrip" : "Cards"}
					</button>
				</div>
			)}
			{body()}
		</div>
	);
}

export default GalleryPanel;
