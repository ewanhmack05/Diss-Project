interface Collection {
	collectionId: string;
	slideId: string;
	collectionName: string;
	created: string;
	userId: string;
}

interface SlideInfo {
	id: string;
	fileName: string;
	width: number;
	height: number;
	tileSize: number;
	objectivePower: number | null;
	mppX: number | null;
	mppY: number | null;
}

interface AnnotationStoreConfig {
	annotationStoreUrl: string;
	tilerUrl: string;
}

async function ensureCollection(config: AnnotationStoreConfig, slideId: string, userId: string): Promise<Collection> {
	const response = await fetch(`${config.annotationStoreUrl}/collections/ensure`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ slideId, userId }),
	});
	if (!response.ok) throw new Error(`ensureCollection failed: ${response.status} ${await response.text()}`);
	return response.json() as Promise<Collection>;
}

async function fetchSlideInfo(config: AnnotationStoreConfig, slideId: string): Promise<SlideInfo> {
	const response = await fetch(`${config.tilerUrl}/slides/${encodeURIComponent(slideId)}`);
	if (!response.ok) throw new Error(`fetchSlideInfo failed for slide "${slideId}": ${response.status} ${await response.text()}`);
	return response.json() as Promise<SlideInfo>;
}

// Same shape/endpoint image-viewer's own AnnotationStoreContext.addAnnotation
// posts to - the bot is just another client of the same public contract, no
// annotation-store changes needed.
async function postAnnotation(config: AnnotationStoreConfig, collectionId: string, payload: object): Promise<void> {
	const response = await fetch(`${config.annotationStoreUrl}/annotations`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ...payload, collectionId }),
	});
	if (!response.ok) throw new Error(`postAnnotation failed: ${response.status} ${await response.text()}`);
}

async function postCellCount(config: AnnotationStoreConfig, collectionId: string, payload: object): Promise<void> {
	const response = await fetch(`${config.annotationStoreUrl}/cellcounts`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ...payload, collectionId }),
	});
	if (!response.ok) throw new Error(`postCellCount failed: ${response.status} ${await response.text()}`);
}

export { ensureCollection, fetchSlideInfo, postAnnotation, postCellCount };
export type { Collection, SlideInfo, AnnotationStoreConfig };
