import { describe, expect, it } from 'vitest';
import {
	normalizeCoordinates,
	parseNeuronCandidates,
	parseTsv,
	pickCoordinates,
	pickLabel,
	sampleBySuperClass,
	type NeuronCandidate,
} from './neurons';

const HEADER =
	'root_id\tpos_x\tpos_y\tpos_z\tsoma_x\tsoma_y\tsoma_z\tsuper_class\tcell_class\tsupertype\tcell_type\themibrain_type\ttop_nt\tside';

function row(fields: Partial<Record<string, string>>): string {
	const columns = HEADER.split('\t');
	return columns.map((col) => fields[col] ?? '').join('\t');
}

describe('parseTsv', () => {
	it('splits header and rows on tabs, dropping trailing blank lines', () => {
		const text = 'a\tb\n1\t2\n3\t4\n';
		const { headers, rows } = parseTsv(text);
		expect(headers).toEqual(['a', 'b']);
		expect(rows).toEqual([
			['1', '2'],
			['3', '4'],
		]);
	});
});

describe('pickLabel', () => {
	it('prefers cell_type over every other field', () => {
		expect(pickLabel({ cell_type: 'PS180', hemibrain_type: 'X', super_class: 'central' })).toBe('PS180');
	});

	it('falls back down the hierarchy when finer fields are blank', () => {
		expect(pickLabel({ cell_type: '', hemibrain_type: '', supertype: '', cell_class: '', super_class: 'visual_projection' })).toBe(
			'visual_projection',
		);
	});

	it('falls back to a generic label when every field is blank', () => {
		expect(pickLabel({ cell_type: '', hemibrain_type: '', supertype: '', cell_class: '', super_class: '' })).toBe('neuron');
	});
});

describe('pickCoordinates', () => {
	it('prefers soma coordinates when present', () => {
		expect(pickCoordinates({ soma_x: '10', soma_y: '20', soma_z: '30', pos_x: '999', pos_y: '999', pos_z: '999' })).toEqual({
			x: 10,
			y: 20,
			z: 30,
		});
	});

	it('falls back to pos coordinates when soma is blank', () => {
		expect(pickCoordinates({ soma_x: '', soma_y: '', soma_z: '', pos_x: '5', pos_y: '6', pos_z: '7' })).toEqual({ x: 5, y: 6, z: 7 });
	});

	it('returns null when neither coordinate triple is usable', () => {
		expect(pickCoordinates({ soma_x: '', soma_y: '', soma_z: '', pos_x: '', pos_y: '', pos_z: '' })).toBeNull();
	});

	it('returns null for non-numeric junk rather than NaN coordinates', () => {
		expect(pickCoordinates({ soma_x: 'n/a', soma_y: 'n/a', soma_z: 'n/a', pos_x: '', pos_y: '', pos_z: '' })).toBeNull();
	});

	it('returns null when soma is only partially present rather than mixing it with pos', () => {
		// soma_z missing - falling through to pos entirely (not blending
		// soma_x/y with pos_z) keeps a neuron's 3D position internally
		// consistent, from one source or the other, never a hybrid.
		expect(pickCoordinates({ soma_x: '10', soma_y: '20', soma_z: '', pos_x: '1', pos_y: '2', pos_z: '3' })).toEqual({
			x: 1,
			y: 2,
			z: 3,
		});
	});
});

describe('parseNeuronCandidates', () => {
	it('drops rows with no root_id or no usable coordinate', () => {
		const text = [
			HEADER,
			row({ root_id: '1', soma_x: '10', soma_y: '20', soma_z: '30', super_class: 'central' }),
			row({ root_id: '', soma_x: '10', soma_y: '20', soma_z: '30' }), // no id
			row({ root_id: '2' }), // no coordinates at all
		].join('\n');

		const candidates = parseNeuronCandidates(text);
		expect(candidates).toHaveLength(1);
		expect(candidates[0].id).toBe('1');
	});

	it('labels unclassified super_class explicitly rather than leaving it blank', () => {
		const text = [HEADER, row({ root_id: '1', soma_x: '10', soma_y: '20', soma_z: '30', super_class: '' })].join('\n');
		expect(parseNeuronCandidates(text)[0].superClass).toBe('unclassified');
	});
});

function candidate(id: string, superClass: string, x = 0, y = 0, z = 0): NeuronCandidate {
	return { id, label: 'x', superClass, side: null, neurotransmitter: null, rawX: x, rawY: y, rawZ: z };
}

describe('sampleBySuperClass', () => {
	it('caps how many are taken from each class', () => {
		const candidates = [
			...Array.from({ length: 10 }, (_, i) => candidate(`a${i}`, 'central', i)),
			...Array.from({ length: 10 }, (_, i) => candidate(`b${i}`, 'visual', i)),
		];
		const sample = sampleBySuperClass(candidates, { perClassCap: 3, targetTotal: 1000 });
		expect(sample.filter((c) => c.superClass === 'central')).toHaveLength(3);
		expect(sample.filter((c) => c.superClass === 'visual')).toHaveLength(3);
	});

	it('further caps the combined sample to targetTotal', () => {
		const candidates = [
			...Array.from({ length: 10 }, (_, i) => candidate(`a${i}`, 'central', i)),
			...Array.from({ length: 10 }, (_, i) => candidate(`b${i}`, 'visual', i)),
		];
		const sample = sampleBySuperClass(candidates, { perClassCap: 10, targetTotal: 5 });
		expect(sample).toHaveLength(5);
	});

	it('is deterministic - same input always produces the same sample', () => {
		const candidates = Array.from({ length: 50 }, (_, i) => candidate(`n${i}`, 'central', i));
		const first = sampleBySuperClass(candidates, { perClassCap: 7, targetTotal: 7 });
		const second = sampleBySuperClass(candidates, { perClassCap: 7, targetTotal: 7 });
		expect(first.map((c) => c.id)).toEqual(second.map((c) => c.id));
	});

	it('never returns more than were given', () => {
		const candidates = [candidate('only-one', 'central', 0)];
		const sample = sampleBySuperClass(candidates, { perClassCap: 100, targetTotal: 100 });
		expect(sample).toHaveLength(1);
	});
});

describe('normalizeCoordinates', () => {
	it('maps the coordinate range to [0, 1] on all three axes independently', () => {
		const candidates = [
			candidate('a', 'central', 0, 0, 0),
			candidate('b', 'central', 50, 100, 1000),
			candidate('c', 'central', 100, 200, 2000),
		];
		const normalized = normalizeCoordinates(candidates);
		expect(normalized[0]).toMatchObject({ x: 0, y: 0, z: 0 });
		expect(normalized[1]).toMatchObject({ x: 0.5, y: 0.5, z: 0.5 });
		expect(normalized[2]).toMatchObject({ x: 1, y: 1, z: 1 });
	});

	it('does not divide by zero when every point shares a coordinate', () => {
		const candidates = [candidate('a', 'central', 5, 5, 5), candidate('b', 'central', 5, 5, 5)];
		const normalized = normalizeCoordinates(candidates);
		expect(normalized.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z))).toBe(true);
	});

	it('normalizes each axis independently, not against a shared range', () => {
		// x spans 0-10, y spans 0-1000 - each axis's own min/max, not one
		// range applied to all three, is what must drive its normalization.
		const candidates = [candidate('a', 'central', 0, 0, 0), candidate('b', 'central', 10, 1000, 5)];
		const normalized = normalizeCoordinates(candidates);
		expect(normalized[1]).toMatchObject({ x: 1, y: 1, z: 1 });
	});

	it('returns an empty array for empty input', () => {
		expect(normalizeCoordinates([])).toEqual([]);
	});
});
