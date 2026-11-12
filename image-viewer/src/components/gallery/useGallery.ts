import { useEffect, useMemo, useState } from "react";
import { useImageViewerContext } from "../../context/ImageViewerContext";
import { useAuthContext } from "../../context/AuthContext";
import { useAnnotationStoreContext } from "../../context/AnnotationStoreContext";
import { useCellCountStoreContext } from "../../context/CellCountStoreContext";
import { usePresenceContext } from "../../context/PresenceContext";
import { sortSlides, type GallerySlide, type SlideSummary } from "./slides";

type Status = "loading" | "ready" | "error";

interface Gallery {
	status: Status;
	slides: GallerySlide[];
	// By slide id. Missing means nothing on it - or the store couldn't be
	// reached, which summaryFailed says.
	summaries: Map<string, SlideSummary>;
	summaryFailed: boolean;
	// Other people with each slide open now, by slide id.
	people: Map<string, number>;
}

// Every slide the tiler has, what annotation-store knows about each, and who's
// on them. The slides are loaded once. The counts again whenever something's
// added or taken away here, or the slide changes, so they stay right while
// it's open.
function useGallery(storeUrl: string): Gallery {
	const { source } = useImageViewerContext();
	const { authFetch } = useAuthContext();
	const { revision: annotationRevision } = useAnnotationStoreContext();
	const { revision: cellCountRevision } = useCellCountStoreContext();
	const { users } = usePresenceContext();
	const [status, setStatus] = useState<Status>("loading");
	const [slides, setSlides] = useState<GallerySlide[]>([]);
	const [summaries, setSummaries] = useState<Map<string, SlideSummary>>(new Map());
	const [summaryFailed, setSummaryFailed] = useState(false);

	useEffect(() => {
		let cancelled = false;
		fetch(`${source.tilerUrl}/slides`)
			.then((response) => {
				if (!response.ok) throw new Error(String(response.status));
				return response.json() as Promise<GallerySlide[]>;
			})
			.then((list) => {
				if (cancelled) return;
				setSlides(sortSlides(list));
				setStatus("ready");
			})
			.catch(() => {
				if (!cancelled) setStatus("error");
			});
		return () => {
			cancelled = true;
		};
	}, [source.tilerUrl]);

	useEffect(() => {
		let cancelled = false;
		authFetch(`${storeUrl}/slides/summary`)
			.then((response) => {
				if (!response.ok) throw new Error(String(response.status));
				return response.json() as Promise<SlideSummary[]>;
			})
			.then((list) => {
				if (cancelled) return;
				setSummaries(new Map(list.map((summary) => [summary.slideId, summary])));
				setSummaryFailed(false);
			})
			.catch(() => {
				if (!cancelled) setSummaryFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, [authFetch, storeUrl, source.slideId, annotationRevision, cellCountRevision]);

	const people = useMemo(() => {
		const bySlide = new Map<string, number>();
		for (const user of users) {
			const slideId = user.online?.slideId;
			if (slideId) bySlide.set(slideId, (bySlide.get(slideId) ?? 0) + 1);
		}
		return bySlide;
	}, [users]);

	return { status, slides, summaries, summaryFailed, people };
}

export { useGallery };
export type { Gallery };
