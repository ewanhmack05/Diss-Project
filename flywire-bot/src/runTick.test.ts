import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from './annotationStore/client';
import { defaultControlState } from './control';
import type { SeedFile } from './data/seed';
import { runTick } from './runTick';

const CONFIG = { annotationStoreUrl: 'http://x', tilerUrl: 'http://y' };
const SLIDE = { width: 1000, height: 1000 };

const SEED: Pick<SeedFile, 'neurons' | 'connections'> = {
	neurons: [
		{ id: 'a', label: 'PS180', superClass: 'central', side: 'left', neurotransmitter: 'acetylcholine', x: 0.1, y: 0.1, z: 0.1 },
		{ id: 'b', label: 'LC27', superClass: 'visual_projection', side: 'right', neurotransmitter: 'glutamate', x: 0.9, y: 0.9, z: 0.9 },
	],
	connections: [{ preId: 'a', postId: 'b', synapses: 4, neurotransmitter: 'acetylcholine' }],
};

const NEURONS_BY_ID = new Map(SEED.neurons.map((n) => [n.id, n]));

function context(overrides: Partial<Parameters<typeof runTick>[1]> = {}) {
	return {
		config: CONFIG,
		collectionId: 'col-1',
		slide: SLIDE,
		seed: SEED,
		neuronsById: NEURONS_BY_ID,
		control: defaultControlState(),
		log: vi.fn(),
		...overrides,
	};
}

describe('runTick', () => {
	let postAnnotationSpy: ReturnType<typeof vi.spyOn>;
	let postCellCountSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		postAnnotationSpy = vi.spyOn(client, 'postAnnotation').mockResolvedValue(undefined);
		postCellCountSpy = vi.spyOn(client, 'postCellCount').mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('posts an annotation on a tick%3===0 tick, for the tick-indexed neuron', async () => {
		await runTick(0, context());

		expect(postAnnotationSpy).toHaveBeenCalledTimes(1);
		expect(postCellCountSpy).not.toHaveBeenCalled();
		const [, collectionId, payload] = postAnnotationSpy.mock.calls[0];
		expect(collectionId).toBe('col-1');
		expect((payload as { label: string }).label).toBe('FlyWire - PS180');
	});

	it('posts a cell count on a tick%3===1 tick', async () => {
		await runTick(1, context());

		expect(postCellCountSpy).toHaveBeenCalledTimes(1);
		expect(postAnnotationSpy).not.toHaveBeenCalled();
	});

	it('posts a pathway (as an annotation) on a tick%3===2 tick', async () => {
		await runTick(2, context());

		expect(postAnnotationSpy).toHaveBeenCalledTimes(1);
		expect(postCellCountSpy).not.toHaveBeenCalled();
		const [, , payload] = postAnnotationSpy.mock.calls[0];
		expect((payload as { label: string; shape: string }).shape).toBe('arrow');
		expect((payload as { label: string }).label).toBe('FlyWire - PS180 → LC27');
	});

	it('wraps to the first neuron once the tick exceeds the seed length', async () => {
		// tick 6: 6 % 3 === 0 (annotation) and 6 % 2 === 0 (back to neuron 'a')
		await runTick(6, context());
		const [, , payload] = postAnnotationSpy.mock.calls[0];
		expect((payload as { label: string }).label).toBe('FlyWire - PS180');
	});

	it('logs a one-line summary of what it did', async () => {
		const log = vi.fn();
		await runTick(0, context({ log }));
		expect(log).toHaveBeenCalledWith(expect.stringContaining('PS180'));
	});

	it('propagates a post failure rather than swallowing it', async () => {
		postAnnotationSpy.mockRejectedValue(new Error('network down'));
		await expect(runTick(0, context())).rejects.toThrow('network down');
	});

	it('throws a clear error if a connection references a neuron missing from neuronsById', async () => {
		const brokenSeed: Pick<SeedFile, 'neurons' | 'connections'> = {
			neurons: [SEED.neurons[0]],
			connections: [{ preId: 'a', postId: 'nonexistent', synapses: 1, neurotransmitter: 'gaba' }],
		};
		const brokenNeuronsById = new Map(brokenSeed.neurons.map((n) => [n.id, n]));

		await expect(runTick(2, context({ seed: brokenSeed, neuronsById: brokenNeuronsById }))).rejects.toThrow(/nonexistent/);
	});

	it('fires onEvent with an annotation event on a tick%3===0 tick', async () => {
		const onEvent = vi.fn();
		await runTick(0, context({ onEvent }));
		expect(onEvent).toHaveBeenCalledTimes(1);
		expect(onEvent.mock.calls[0][0]).toMatchObject({ type: 'annotation', tick: 0, neuronId: 'a' });
	});

	it('fires onEvent with a cellCount event on a tick%3===1 tick', async () => {
		const onEvent = vi.fn();
		await runTick(1, context({ onEvent }));
		expect(onEvent.mock.calls[0][0]).toMatchObject({ type: 'cellCount', tick: 1, neuronId: 'b' });
	});

	it('fires onEvent with a pathway event (both ends) on a tick%3===2 tick', async () => {
		const onEvent = vi.fn();
		await runTick(2, context({ onEvent }));
		expect(onEvent.mock.calls[0][0]).toMatchObject({ type: 'pathway', tick: 2, preId: 'a', postId: 'b' });
	});

	it('does not fire onEvent when the post fails', async () => {
		postAnnotationSpy.mockRejectedValue(new Error('network down'));
		const onEvent = vi.fn();
		await expect(runTick(0, context({ onEvent }))).rejects.toThrow();
		expect(onEvent).not.toHaveBeenCalled();
	});

	it('never breaks when onEvent is omitted', async () => {
		await expect(runTick(0, context({ onEvent: undefined }))).resolves.toBeUndefined();
	});

	it('skips an annotation tick entirely when annotations are disabled', async () => {
		const onEvent = vi.fn();
		await runTick(0, context({ control: { ...defaultControlState(), annotationsEnabled: false }, onEvent }));
		expect(postAnnotationSpy).not.toHaveBeenCalled();
		expect(onEvent).not.toHaveBeenCalled();
	});

	it('skips a cellCount tick entirely when cell counting is disabled', async () => {
		const onEvent = vi.fn();
		await runTick(1, context({ control: { ...defaultControlState(), cellCountEnabled: false }, onEvent }));
		expect(postCellCountSpy).not.toHaveBeenCalled();
		expect(onEvent).not.toHaveBeenCalled();
	});

	it('never gates a pathway tick, regardless of the other two flags', async () => {
		const control = { ...defaultControlState(), annotationsEnabled: false, cellCountEnabled: false };
		await runTick(2, context({ control }));
		expect(postAnnotationSpy).toHaveBeenCalledTimes(1);
	});

	it('still runs an annotation tick when only cellCount is disabled', async () => {
		await runTick(0, context({ control: { ...defaultControlState(), cellCountEnabled: false } }));
		expect(postAnnotationSpy).toHaveBeenCalledTimes(1);
	});

	it('projects a neuron-based tick into the configured region', async () => {
		const region = { x: 0, y: 0, width: 0.5, height: 0.5 };
		await runTick(0, context({ control: { ...defaultControlState(), region } }));
		const [, , payload] = postAnnotationSpy.mock.calls[0];
		const { coordinates } = JSON.parse((payload as { geoJson: string }).geoJson).geometry;
		// neuron 'a' is at x:0.1,y:0.1 - within a region half the slide's size,
		// its map coordinate is half of what it would be at full extent.
		expect(coordinates).toEqual([50, -50]);
	});

	it('projects a pathway tick into the configured region too', async () => {
		const region = { x: 0, y: 0, width: 0.5, height: 0.5 };
		await runTick(2, context({ control: { ...defaultControlState(), region } }));
		const [, , payload] = postAnnotationSpy.mock.calls[0];
		const { coordinates } = JSON.parse((payload as { geoJson: string }).geoJson).geometry;
		expect(coordinates).toEqual([
			[50, -50],
			[450, -450],
		]);
	});
});
