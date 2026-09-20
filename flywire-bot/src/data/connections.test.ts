import { tableFromJSON } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { aggregateConnections, pickDominantNeurotransmitter, readConnectionRows, type RawConnectionRow } from './connections';

describe('pickDominantNeurotransmitter', () => {
	it('picks whichever average is highest', () => {
		expect(pickDominantNeurotransmitter({ gaba: 0.9, ach: 0.02, glut: 0.02, oct: 0.02, ser: 0.02, da: 0.02 })).toBe('gaba');
		expect(pickDominantNeurotransmitter({ gaba: 0.1, ach: 0.7, glut: 0.1, oct: 0.03, ser: 0.03, da: 0.04 })).toBe('acetylcholine');
	});

	it('is deterministic on a tie - takes the first max encountered', () => {
		expect(pickDominantNeurotransmitter({ gaba: 0.5, ach: 0.5, glut: 0, oct: 0, ser: 0, da: 0 })).toBe('gaba');
	});
});

describe('readConnectionRows', () => {
	it('extracts every declared column into plain rows', () => {
		const table = tableFromJSON([
			{ pre_pt_root_id: 'n1', post_pt_root_id: 'n2', neuropil: 'AVLP_R', syn_count: 5, gaba_avg: 0.1, ach_avg: 0.8, glut_avg: 0.05, oct_avg: 0.02, ser_avg: 0.02, da_avg: 0.01 },
			{ pre_pt_root_id: 'n2', post_pt_root_id: 'n3', neuropil: 'SMP_L', syn_count: 2, gaba_avg: 0.9, ach_avg: 0.02, glut_avg: 0.02, oct_avg: 0.02, ser_avg: 0.02, da_avg: 0.02 },
		]);

		const rows = readConnectionRows(table);
		expect(rows).toEqual<RawConnectionRow[]>([
			{ pre: 'n1', post: 'n2', synCount: 5, neuropil: 'AVLP_R', neurotransmitter: 'acetylcholine' },
			{ pre: 'n2', post: 'n3', synCount: 2, neuropil: 'SMP_L', neurotransmitter: 'gaba' },
		]);
	});
});

function row(pre: string, post: string, synCount: number, neuropil = 'X', neurotransmitter = 'acetylcholine'): RawConnectionRow {
	return { pre, post, synCount, neuropil, neurotransmitter };
}

describe('aggregateConnections', () => {
	const neuronIds = new Set(['a', 'b', 'c']);

	it('drops any pair where either end is outside the sampled neuron set', () => {
		const rows = [row('a', 'b', 5), row('a', 'outsider', 100), row('outsider', 'b', 100)];
		const result = aggregateConnections(rows, neuronIds, { maxConnections: 10 });
		expect(result).toEqual([{ preId: 'a', postId: 'b', synapses: 5, neurotransmitter: 'acetylcholine' }]);
	});

	it('sums synapse counts across neuropils for the same directed pair', () => {
		const rows = [row('a', 'b', 5, 'AVLP_R'), row('a', 'b', 3, 'SMP_L')];
		const result = aggregateConnections(rows, neuronIds, { maxConnections: 10 });
		expect(result).toEqual([{ preId: 'a', postId: 'b', synapses: 8, neurotransmitter: 'acetylcholine' }]);
	});

	it('keeps the neurotransmitter from whichever contributing row had the most synapses', () => {
		const rows = [row('a', 'b', 2, 'AVLP_R', 'gaba'), row('a', 'b', 9, 'SMP_L', 'glutamate')];
		const result = aggregateConnections(rows, neuronIds, { maxConnections: 10 });
		expect(result[0].neurotransmitter).toBe('glutamate');
	});

	it('treats pre->post and post->pre as distinct connections', () => {
		const rows = [row('a', 'b', 5), row('b', 'a', 7)];
		const result = aggregateConnections(rows, neuronIds, { maxConnections: 10 });
		expect(result).toHaveLength(2);
	});

	it('sorts by total synapses descending and caps at maxConnections', () => {
		const rows = [row('a', 'b', 1), row('b', 'c', 50), row('a', 'c', 25)];
		const result = aggregateConnections(rows, neuronIds, { maxConnections: 2 });
		expect(result.map((c) => c.synapses)).toEqual([50, 25]);
	});

	it('returns an empty array when nothing matches', () => {
		expect(aggregateConnections([row('x', 'y', 5)], neuronIds, { maxConnections: 10 })).toEqual([]);
	});
});
