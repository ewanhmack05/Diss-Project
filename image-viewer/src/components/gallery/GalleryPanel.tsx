import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
	peopleText,
	physicalText,
	pixelsText,
	positionText,
	scannerText,
	slideName,
	thumbnailRetryDelay,
	thumbnailUrl,
	wholeSlideTileUrl,
	zoomText,
	type GallerySlide,
} from "./slides";
import {
	GALLERY_PAGE_SIZE,
	NO_GALLERY_FILTERS,
	filterSlides,
	galleryFacets,
	isGalleryFiltered,
	neighbourShown,
	pageOf,
	pageOfSlide,
	shownText,
	type GalleryFilters,
} from "./galleryFilters";
import GalleryFilterMenu from "./GalleryFilterMenu";
import SavedPager from "../saved/SavedPager";
import { clampPage } from "../saved/paging";
import "./GalleryPanel.css";

interface GalleryPanelProps {
	storeUrl: string;
	// Where it's docked, if it is - that decides the layout.
	dockedSide: DockSide | null;
}

// The slide's picture, on its own background colour so a thin portrait slide
// sits in its box rather than stretching to it. A failed thumbnail is tried
// again a couple of times (see thumbnailRetryDelay), then falls back to the
// one tile that's the whole slide.
function Thumbnail({ tilerUrl, slide }: { tilerUrl: string; slide: GallerySlide }) {
	const [failures, setFailures] = useState(0);
	const [attempt, setAttempt] = useState(0);
	const delay = thumbnailRetryDelay(failures);
	const fallback = failures > 0 && delay === null;

	useEffect(() => {
		if (delay === null) return;
		const timer = window.setTimeout(() => setAttempt(failures), delay);
		return () => window.clearTimeout(timer);
	}, [failures, delay]);

	return (
		<span className="gallery-thumb" style={slide.backgroundColour ? { background: slide.backgroundColour } : undefined}>
			<img
				src={fallback ? wholeSlideTileUrl(tilerUrl, slide.id) : thumbnailUrl(tilerUrl, slide.id, attempt)}
				alt=""
				loading="lazy"
				draggable={false}
				onError={() => {
					if (!fallback) setFailures((count) => count + 1);
				}}
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
// everything about each slide, a page at a time, or a strip of pictures - the
// button at the top switches. Docked it's always a strip, running the way the
// edge does, with the arrows on a ribbon over the bottom of it. The search
// box and Filter sheet narrow all of them, and the arrows step through what's
// showing.
function GalleryPanel({ storeUrl, dockedSide }: GalleryPanelProps) {
	const { source, moveToSlide } = useImageViewerContext();
	const gallery = useGallery(storeUrl);
	const [expanded, setExpanded] = useState(true);
	const [search, setSearch] = useState("");
	const [filters, setFilters] = useState<GalleryFilters>(NO_GALLERY_FILTERS);
	const [page, setPage] = useState(0);
	const layout = galleryLayout(dockedSide, expanded);
	const listRef = useRef<HTMLUListElement>(null);
	const current = source.slideId;

	const shown = useMemo(
		() => filterSlides(gallery.slides, search, filters, { summaries: gallery.summaries, people: gallery.people }),
		[gallery.slides, gallery.summaries, gallery.people, search, filters],
	);
	const facets = useMemo(() => galleryFacets(gallery.slides), [gallery.slides]);
	const filtered = isGalleryFiltered(search, filters);
	const cards = layout === "cards";
	const onPage = cards ? pageOf(shown, clampPage(page, shown.length, GALLERY_PAGE_SIZE), GALLERY_PAGE_SIZE) : shown;

	// The cards open on the page the open slide's on - when it moves, when
	// switching to cards and when the slides arrive. Not when what's showing
	// changes otherwise: a live count going up mustn't move the page under you,
	// and searching and filtering start from the first page (see narrow).
	// Before paint, or the first page is drawn for a frame and its thumbnails
	// are asked for on the way.
	const jumpWhen = `${current}|${cards}|${gallery.slides.length}`;
	const jumpedFor = useRef("");
	useLayoutEffect(() => {
		if (!cards || jumpedFor.current === jumpWhen) return;
		jumpedFor.current = jumpWhen;
		setPage(pageOfSlide(shown, current, GALLERY_PAGE_SIZE));
	}, [jumpWhen, cards, shown, current]);

	// The open one stays in sight - after a move, and when the layout changes.
	useEffect(() => {
		listRef.current?.querySelector<HTMLElement>("[aria-current]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [current, layout, gallery.slides, page]);

	const open = (slide: GallerySlide) => {
		if (slide.id !== current) void moveToSlide(slide.id);
	};
	const narrow = (next: { search?: string; filters?: GalleryFilters }) => {
		if (next.search !== undefined) setSearch(next.search);
		if (next.filters) setFilters(next.filters);
		setPage(0);
		listRef.current?.scrollTo({ top: 0, left: 0 });
	};
	const turnPage = (next: number) => {
		setPage(next);
		listRef.current?.scrollTo({ top: 0 });
	};
	const previous = neighbourShown(shown, gallery.slides, current, -1);
	const next = neighbourShown(shown, gallery.slides, current, 1);
	const vertical = layout === "strip-vertical";
	const ready = gallery.status === "ready" && gallery.slides.length > 0;

	const body = () => {
		if (gallery.status === "loading") return <p className="gallery-note">Loading slides…</p>;
		if (gallery.status === "error") return <p className="gallery-note">Couldn't reach the tile server for the list of slides.</p>;
		if (gallery.slides.length === 0) return <p className="gallery-note">The tile server has no slides.</p>;
		if (shown.length === 0) {
			return (
				<div className="gallery-note gallery-none">
					No slides match.
					<button type="button" className="gallery-bar-button" onClick={() => narrow({ search: "", filters: NO_GALLERY_FILTERS })}>
						Clear search and filters
					</button>
				</div>
			);
		}
		if (cards) {
			return (
				<>
					<ul ref={listRef} className="gallery-cards themed-scroll">
						{onPage.map((slide) => (
							<Card key={slide.id} slide={slide} current={slide.id === current} gallery={gallery} onOpen={open} />
						))}
					</ul>
					<div className="gallery-pager">
						<SavedPager page={clampPage(page, shown.length, GALLERY_PAGE_SIZE)} total={shown.length} pageSize={GALLERY_PAGE_SIZE} loading={false} onPage={turnPage} />
					</div>
				</>
			);
		}
		return (
			<div className={`gallery-strip gallery-strip--${vertical ? "vertical" : "horizontal"}`}>
				<ul ref={listRef} className="gallery-strip-list">
					{onPage.map((slide) => (
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
					<span className="gallery-ribbon-text">{positionText(shown, current)}</span>
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
					<span className="gallery-bar-text">
						{gallery.status !== "ready" ? "" : filtered ? shownText(shown, gallery.slides.length, current) : positionText(gallery.slides, current)}
					</span>
					<button type="button" className="gallery-bar-button" aria-pressed={!expanded} onClick={() => setExpanded((now) => !now)}>
						<Icon svg={expanded ? stripSvg : gallerySvg} size={14} />
						{expanded ? "Filmstrip" : "Cards"}
					</button>
				</div>
			)}
			{ready && (
				<div className="saved-search-row gallery-search">
					<input
						type="search"
						className="gallery-search-input"
						value={search}
						placeholder="Search slides"
						aria-label="Search slides by name"
						onChange={(e) => narrow({ search: e.target.value })}
					/>
					<GalleryFilterMenu filters={filters} onChange={(next) => narrow({ filters: next })} facets={facets} collectionsUnknown={gallery.summaryFailed} />
				</div>
			)}
			{body()}
		</div>
	);
}

export default GalleryPanel;
