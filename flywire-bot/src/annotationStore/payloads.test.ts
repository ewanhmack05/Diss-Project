import { describe, expect, it } from 'vitest';
import type { SeedConnection, SeedNeuron } from '../data/seed';
import {
	buildAnnotationPayload,
	buildCellCountPayload,
	buildPathwayPayload,
	colourForNeurotransmitter,
	colourForSuperClass,
	countConnectionsFor,
	lineThicknessForSynapses,
	projectToMapCoordinates,
} from './payloads';

const SLIDE = { width: 1000, height: 2000 };

function neuron(overrides: Partial<SeedNeuron> = {}): SeedNeuron {
	return {
		id: '720575940628857210',
		label: 'PS180',
		superClass: 'central',
		side: 'left',
		neurotransmitter: 'acetylcholine',
		x: 0.25,
		y: 0.5,
		z: 0.75,
		...overrides,
	};
}

describe('projectToMapCoordinates', () => {
	it('scales normalized coordinates by slide dimensions', () => {
		expect(projectToMapCoordinates({ x: 0.5, y: 0.5 }, SLIDE)).toEqual({ x: 500, y: -1000 });
	});

	it('with no region (default), behaves exactly as before - full slide extent', () => {
		expect(projectToMapCoordinates({ x: 0.5, y: 0.5 }, SLIDE, null)).toEqual({ x: 500, y: -1000 });
	});

	it('with a region, remaps [0,0]-[1,1] onto the region\'s own corners instead of the full slide', () => {
		const region = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
		expect(projectToMapCoordinates({ x: 0, y: 0 }, SLIDE, region)).toEqual({ x: 250, y: -500 });
		expect(projectToMapCoordinates({ x: 1, y: 1 }, SLIDE, region)).toEqual({ x: 750, y: -1500 });
		expect(projectToMapCoordinates({ x: 0.5, y: 0.5 }, SLIDE, region)).toEqual({ x: 500, y: -1000 });
	});

	it('flips y so image-space "down" becomes map-space negative (matches OpenLayers.ts getExtent)', () => {
		expect(projectToMapCoordinates({ x: 1, y: 1 }, SLIDE)).toEqual({ x: 1000, y: -2000 });
	});
});

describe('colourForSuperClass', () => {
	it('returns the curated colour for a known super_class', () => {
		expect(colourForSuperClass('central')).toBe('#8B5CF6');
	});

	it('is deterministic for an unrecognized super_class', () => {
		const first = colourForSuperClass('some_future_super_class');
		const second = colourForSuperClass('some_future_super_class');
		expect(first).toBe(second);
	});

	it('returns a colour from the palette even for unknown classes', () => {
		const colour = colourForSuperClass('totally_unknown');
		expect(colour).toMatch(/^#[0-9A-F]{6}$/i);
	});
});

describe('countConnectionsFor', () => {
	const connections: SeedConnection[] = [
		{ preId: 'a', postId: 'b', synapses: 5, neurotransmitter: 'gaba' },
		{ preId: 'c', postId: 'a', synapses: 2, neurotransmitter: 'gaba' },
		{ preId: 'b', postId: 'c', synapses: 1, neurotransmitter: 'gaba' },
	];

	it('counts a neuron appearing as either pre or post', () => {
		expect(countConnectionsFor('a', connections)).toBe(2);
		expect(countConnectionsFor('b', connections)).toBe(2);
	});

	it('returns 0 for a neuron with no connections in the set', () => {
		expect(countConnectionsFor('nobody', connections)).toBe(0);
	});
});

describe('buildAnnotationPayload', () => {
	it('builds a Point-geometry GeoJSON feature at the projected coordinate', () => {
		const payload = buildAnnotationPayload(neuron(), SLIDE, 3);
		const geometry = JSON.parse(payload.geoJson);
		expect(geometry).toEqual({
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [250, -1000] },
			properties: {},
		});
	});

	it('labels and colours by the neuron identity, not a generic marker', () => {
		const payload = buildAnnotationPayload(neuron(), SLIDE, 0);
		expect(payload.label).toBe('FlyWire - PS180');
		expect(payload.colour).toBe(colourForSuperClass('central'));
	});

	it('mentions the connection count in notes only when there are any', () => {
		expect(buildAnnotationPayload(neuron(), SLIDE, 0).notes).not.toMatch(/connection/);
		expect(buildAnnotationPayload(neuron(), SLIDE, 1).notes).toMatch(/1 synaptic connection in this sample/);
		expect(buildAnnotationPayload(neuron(), SLIDE, 4).notes).toMatch(/4 synaptic connections in this sample/);
	});

	it('stays within a given region instead of the full slide', () => {
		const region = { x: 0, y: 0, width: 0.5, height: 0.5 };
		const payload = buildAnnotationPayload(neuron(), SLIDE, 0, region);
		const { coordinates } = JSON.parse(payload.geoJson).geometry;
		expect(coordinates).toEqual([125, -500]);
	});
});

describe('buildCellCountPayload', () => {
	it('places exactly one dot at the projected coordinate, coloured by super_class', () => {
		const payload = buildCellCountPayload(neuron(), SLIDE, 0);
		const dots = JSON.parse(payload.dots);
		expect(dots).toEqual([{ x: 250, y: -1000, colour: colourForSuperClass('central') }]);
		expect(payload.count).toBe(1);
		expect(payload.locationX).toBe(250);
		expect(payload.locationY).toBe(-1000);
	});

	it('always records withAnnotation true so the dot is actually visible', () => {
		expect(buildCellCountPayload(neuron(), SLIDE, 0).withAnnotation).toBe(true);
	});

	it('stays within a given region instead of the full slide', () => {
		const region = { x: 0, y: 0, width: 0.5, height: 0.5 };
		const payload = buildCellCountPayload(neuron(), SLIDE, 0, region);
		expect(payload.locationX).toBe(125);
		expect(payload.locationY).toBe(-500);
	});
});

describe('colourForNeurotransmitter', () => {
	it('returns the curated colour for a known neurotransmitter', () => {
		expect(colourForNeurotransmitter('gaba')).toBe('#F43F5E');
	});

	it('falls back to a neutral colour for null or unknown', () => {
		expect(colourForNeurotransmitter(null)).toBe('#94A3B8');
		expect(colourForNeurotransmitter('made_up_transmitter')).toBe('#94A3B8');
	});
});

describe('lineThicknessForSynapses', () => {
	it('increases with synapse count', () => {
		expect(lineThicknessForSynapses(0)).toBeLessThanOrEqual(lineThicknessForSynapses(50));
		expect(lineThicknessForSynapses(50)).toBeLessThanOrEqual(lineThicknessForSynapses(500));
	});

	it('never goes below the minimum, even for 0 synapses', () => {
		expect(lineThicknessForSynapses(0)).toBe(1);
	});

	it('caps at the maximum for a very high synapse count', () => {
		expect(lineThicknessForSynapses(100_000)).toBe(6);
	});
});

describe('buildPathwayPayload', () => {
	const pre = neuron({ id: 'pre-1', label: 'T5c', x: 0, y: 0 });
	const post = neuron({ id: 'post-1', label: 'LC27', x: 1, y: 1 });
	const connection: SeedConnection = { preId: 'pre-1', postId: 'post-1', synapses: 40, neurotransmitter: 'gaba' };

	it('builds a two-point LineString from the presynaptic to the postsynaptic neuron', () => {
		const payload = buildPathwayPayload(pre, post, connection, SLIDE);
		const geometry = JSON.parse(payload.geoJson);
		expect(geometry).toEqual({
			type: 'Feature',
			geometry: {
				type: 'LineString',
				coordinates: [
					[0, 0],
					[1000, -2000],
				],
			},
			properties: {},
		});
	});

	it('draws it as an arrow, so direction (pre -> post) is visible', () => {
		expect(buildPathwayPayload(pre, post, connection, SLIDE).shape).toBe('arrow');
	});

	it('labels with both neuron names and an arrow between them', () => {
		expect(buildPathwayPayload(pre, post, connection, SLIDE).label).toBe('FlyWire - T5c → LC27');
	});

	it('colours by the connection neurotransmitter, not either neuron super_class', () => {
		expect(buildPathwayPayload(pre, post, connection, SLIDE).colour).toBe(colourForNeurotransmitter('gaba'));
	});

	it('notes the synapse count and neurotransmitter', () => {
		expect(buildPathwayPayload(pre, post, connection, SLIDE).notes).toBe('40 synapses · neurotransmitter: gaba');
	});

	it('uses singular "synapse" for a count of exactly one', () => {
		const single: SeedConnection = { ...connection, synapses: 1 };
		expect(buildPathwayPayload(pre, post, single, SLIDE).notes).toMatch(/^1 synapse /);
	});

	it('keeps both ends of the line within a given region instead of the full slide', () => {
		const region = { x: 0, y: 0, width: 0.5, height: 0.5 };
		const payload = buildPathwayPayload(pre, post, connection, SLIDE, region);
		const { coordinates } = JSON.parse(payload.geoJson).geometry;
		expect(coordinates).toEqual([
			[0, 0],
			[500, -1000],
		]);
	});
});
