import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureCollection, fetchSlideInfo, postAnnotation, postCellCount } from './client';

const CONFIG = { annotationStoreUrl: 'http://localhost:5252', tilerUrl: 'http://localhost:5095' };

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
	return {
		ok,
		status,
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(JSON.stringify(body)),
	} as Response;
}

describe('annotationStore client', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('ensureCollection POSTs slideId and userId and returns the collection', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ collectionId: 'c1', slideId: '000', collectionName: 'x', created: 'now', userId: 'bot' }));

		const result = await ensureCollection(CONFIG, '000', 'bot');

		expect(fetchMock).toHaveBeenCalledWith(
			'http://localhost:5252/collections/ensure',
			expect.objectContaining({ method: 'POST', body: JSON.stringify({ slideId: '000', userId: 'bot' }) }),
		);
		expect(result.collectionId).toBe('c1');
	});

	it('ensureCollection throws with status and body on failure', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, false, 400));
		await expect(ensureCollection(CONFIG, '000', 'bot')).rejects.toThrow(/400/);
	});

	it('fetchSlideInfo requests the given slide id and returns its info', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ id: '000', fileName: 'a.mrxs', width: 100, height: 200, tileSize: 256, objectivePower: null, mppX: null, mppY: null }));

		const info = await fetchSlideInfo(CONFIG, '000');

		expect(fetchMock).toHaveBeenCalledWith('http://localhost:5095/slides/000');
		expect(info.width).toBe(100);
	});

	it('fetchSlideInfo error message names the slide id that failed', async () => {
		fetchMock.mockResolvedValue(jsonResponse({}, false, 404));
		await expect(fetchSlideInfo(CONFIG, 'missing-slide')).rejects.toThrow(/missing-slide/);
	});

	it('postAnnotation merges collectionId into the payload body', async () => {
		fetchMock.mockResolvedValue(jsonResponse({}));
		await postAnnotation(CONFIG, 'col-1', { label: 'x' });

		expect(fetchMock).toHaveBeenCalledWith(
			'http://localhost:5252/annotations',
			expect.objectContaining({ method: 'POST', body: JSON.stringify({ label: 'x', collectionId: 'col-1' }) }),
		);
	});

	it('postAnnotation throws on a non-ok response', async () => {
		fetchMock.mockResolvedValue(jsonResponse({}, false, 500));
		await expect(postAnnotation(CONFIG, 'col-1', { label: 'x' })).rejects.toThrow(/500/);
	});

	it('postCellCount merges collectionId into the payload body', async () => {
		fetchMock.mockResolvedValue(jsonResponse({}));
		await postCellCount(CONFIG, 'col-1', { count: 1 });

		expect(fetchMock).toHaveBeenCalledWith(
			'http://localhost:5252/cellcounts',
			expect.objectContaining({ method: 'POST', body: JSON.stringify({ count: 1, collectionId: 'col-1' }) }),
		);
	});

	it('postCellCount throws on a non-ok response', async () => {
		fetchMock.mockResolvedValue(jsonResponse({}, false, 422));
		await expect(postCellCount(CONFIG, 'col-1', { count: 1 })).rejects.toThrow(/422/);
	});
});
