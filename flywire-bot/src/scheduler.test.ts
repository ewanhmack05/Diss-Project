import { describe, expect, it } from 'vitest';
import type { SeedConnection, SeedNeuron } from './data/seed';
import { actionForTick, pickConnectionForTick, pickNeuronForTick } from './scheduler';

describe('actionForTick', () => {
	it('cycles through annotation, cellCount, pathway in order', () => {
		expect([0, 1, 2, 3, 4, 5].map(actionForTick)).toEqual([
			'annotation',
			'cellCount',
			'pathway',
			'annotation',
			'cellCount',
			'pathway',
		]);
	});

	it('is a pure function of the tick - same input always gives the same action', () => {
		expect(actionForTick(7)).toBe(actionForTick(7));
	});
});

function neuron(id: string): SeedNeuron {
	return { id, label: id, superClass: 'central', side: null, neurotransmitter: null, x: 0, y: 0, z: 0 };
}

describe('pickNeuronForTick', () => {
	const neurons = [neuron('a'), neuron('b'), neuron('c')];

	it('picks in order for the first pass', () => {
		expect([0, 1, 2].map((tick) => pickNeuronForTick(neurons, tick).id)).toEqual(['a', 'b', 'c']);
	});

	it('wraps around indefinitely rather than running out', () => {
		expect(pickNeuronForTick(neurons, 3).id).toBe('a');
		expect(pickNeuronForTick(neurons, 100).id).toBe(neurons[100 % neurons.length].id);
	});

	it('throws a clear error on an empty seed rather than returning undefined', () => {
		expect(() => pickNeuronForTick([], 0)).toThrow(/no neurons/);
	});
});

function connection(preId: string, postId: string): SeedConnection {
	return { preId, postId, synapses: 1, neurotransmitter: 'acetylcholine' };
}

describe('pickConnectionForTick', () => {
	const connections = [connection('a', 'b'), connection('b', 'c'), connection('c', 'a')];

	it('picks in order for the first pass', () => {
		expect([0, 1, 2].map((tick) => pickConnectionForTick(connections, tick))).toEqual(connections);
	});

	it('wraps around indefinitely rather than running out', () => {
		expect(pickConnectionForTick(connections, 3)).toEqual(connections[0]);
	});

	it('throws a clear error on an empty seed rather than returning undefined', () => {
		expect(() => pickConnectionForTick([], 0)).toThrow(/no connections/);
	});
});
