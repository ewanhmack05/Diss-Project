import type { NormalizedRegion } from '../control';
import type { SeedConnection, SeedNeuron } from '../data/seed';

interface SlideDimensions {
	width: number;
	height: number;
}

interface MapCoordinate {
	x: number;
	y: number;
}

// image-viewer projects a slide onto its own pixel grid with Y flipped
// (extent = [0, -height, width, 0] - see image-viewer/src/components/
// open-layers/OpenLayers.ts:getExtent), because OpenLayers extents grow
// upward but image rows grow downward. A neuron's normalized [0,1] seed
// position maps to image pixel (x, y) top-left/y-down, so it becomes map
// coordinate (x, -y) to land in the same place image-viewer would draw it.
//
// When a region is set, the neuron's own [0,1] position is first remapped
// into that sub-rectangle of the slide (still [0,1] overall, just a smaller
// span of it) before the same slide-pixel scaling - a neuron at its own
// (0,0) lands at the region's top-left corner rather than the whole
// slide's, and (1,1) at the region's bottom-right, so every placement stays
// inside the drawn working area instead of scattering across the full
// slide. No region (the default) is exactly the original full-slide
// behaviour - existing callers that never pass one are unaffected.
function projectToMapCoordinates(normalized: { x: number; y: number }, slide: SlideDimensions, region: NormalizedRegion | null = null): MapCoordinate {
	const x = region ? region.x + normalized.x * region.width : normalized.x;
	const y = region ? region.y + normalized.y * region.height : normalized.y;
	return {
		x: x * slide.width,
		y: -(y * slide.height),
	};
}

// A fixed palette keyed by FlyWire's own super_class values - distinct from
// image-viewer's PreDefinedColours (Tools.ts) so a bot-drawn item never
// visually passes for a human-drawn one even before its label is read.
// Classes not in this table (there are dozens of finer-grained ones in the
// source data) fall back to a deterministic hash into the same palette, so
// the same super_class string always renders the same colour across runs.
const SUPER_CLASS_PALETTE: Record<string, string> = {
	central: '#8B5CF6',
	visual_projection: '#EC4899',
	optic: '#F59E0B',
	sensory: '#10B981',
	motor: '#3B82F6',
	ascending: '#14B8A6',
	descending: '#EF4444',
	endocrine: '#84CC16',
	visual_centrifugal: '#F97316',
	unclassified: '#6B7280',
};

const FALLBACK_PALETTE = Object.values(SUPER_CLASS_PALETTE);

function hashString(value: string): number {
	let hash = 0;
	for (let i = 0; i < value.length; i++) {
		hash = (hash * 31 + value.charCodeAt(i)) | 0;
	}
	return Math.abs(hash);
}

function colourForSuperClass(superClass: string): string {
	return SUPER_CLASS_PALETTE[superClass] ?? FALLBACK_PALETTE[hashString(superClass) % FALLBACK_PALETTE.length];
}

// A pathway connects two neurons that can each be a different super_class,
// so it's coloured by its own neurotransmitter instead - FlyWire's own
// per-synapse prediction (see connections.ts's pickDominantNeurotransmitter),
// already a meaningful, always-present property of a connection.
const NEUROTRANSMITTER_PALETTE: Record<string, string> = {
	acetylcholine: '#22D3EE',
	gaba: '#F43F5E',
	glutamate: '#A3E635',
	octopamine: '#FB923C',
	serotonin: '#C084FC',
	dopamine: '#FBBF24',
};

const NEUROTRANSMITTER_FALLBACK_COLOUR = '#94A3B8';

function colourForNeurotransmitter(neurotransmitter: string | null): string {
	if (neurotransmitter === null) return NEUROTRANSMITTER_FALLBACK_COLOUR;
	return NEUROTRANSMITTER_PALETTE[neurotransmitter] ?? NEUROTRANSMITTER_FALLBACK_COLOUR;
}

// More synapses between the same pair of neurons is a stronger real
// connection - thicker line reads as "stronger" without needing a legend.
// Clamped so one enormous outlier connection can't dwarf every other line
// on the slide.
const MIN_PATHWAY_THICKNESS = 1;
const MAX_PATHWAY_THICKNESS = 6;
const SYNAPSES_PER_THICKNESS_STEP = 25;

function lineThicknessForSynapses(synapses: number): number {
	const steps = Math.floor(synapses / SYNAPSES_PER_THICKNESS_STEP);
	return Math.min(MAX_PATHWAY_THICKNESS, MIN_PATHWAY_THICKNESS + steps);
}

interface AnnotationPayload {
	label: string;
	notes: string;
	colour: string;
	shape: 'circle' | 'arrow';
	lineStyle: 'solid';
	lineThickness: number;
	geoJson: string;
}

function describeNeuron(neuron: SeedNeuron, connectionCount: number): string {
	const parts = [
		`FlyWire root id ${neuron.id}`,
		`side: ${neuron.side ?? 'unknown'}`,
		`neurotransmitter: ${neuron.neurotransmitter ?? 'unknown'}`,
	];
	if (connectionCount > 0) parts.push(`${connectionCount} synaptic connection${connectionCount === 1 ? '' : 's'} in this sample`);
	return parts.join(' · ');
}

function buildAnnotationPayload(neuron: SeedNeuron, slide: SlideDimensions, connectionCount: number, region: NormalizedRegion | null = null): AnnotationPayload {
	const { x, y } = projectToMapCoordinates(neuron, slide, region);
	return {
		label: `FlyWire - ${neuron.label}`,
		notes: describeNeuron(neuron, connectionCount),
		colour: colourForSuperClass(neuron.superClass),
		shape: 'circle',
		lineStyle: 'solid',
		lineThickness: 2,
		geoJson: JSON.stringify({
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [x, y] },
			properties: {},
		}),
	};
}

interface CellCountPayload {
	label: string;
	notes: string;
	dots: string;
	withAnnotation: true;
	withRoi: false;
	count: number;
	dotSize: number;
	locationX: number;
	locationY: number;
}

const CELL_COUNT_DOT_SIZE = 6;

function buildCellCountPayload(neuron: SeedNeuron, slide: SlideDimensions, connectionCount: number, region: NormalizedRegion | null = null): CellCountPayload {
	const { x, y } = projectToMapCoordinates(neuron, slide, region);
	const colour = colourForSuperClass(neuron.superClass);
	return {
		label: `FlyWire - ${neuron.label} cell count`,
		notes: describeNeuron(neuron, connectionCount),
		dots: JSON.stringify([{ x, y, colour }]),
		withAnnotation: true,
		withRoi: false,
		count: 1,
		dotSize: CELL_COUNT_DOT_SIZE,
		locationX: x,
		locationY: y,
	};
}

// How many of a neuron's connections (either direction) landed in the
// sampled connection set - purely for the "N synaptic connections" line in
// describeNeuron above.
function countConnectionsFor(neuronId: string, connections: readonly SeedConnection[]): number {
	let count = 0;
	for (const connection of connections) {
		if (connection.preId === neuronId || connection.postId === neuronId) count++;
	}
	return count;
}

// The pathway itself, not just the two neurons at its ends - a directed
// line (drawn as an "arrow" annotation, the one shape image-viewer already
// renders with a head at its end - see image-viewer/src/components/
// open-layers/Styles.ts's withArrowHead) from the presynaptic neuron to the
// postsynaptic one, so the direction synapses actually carry signal in is
// visible, not just that a connection exists.
function buildPathwayPayload(
	preNeuron: SeedNeuron,
	postNeuron: SeedNeuron,
	connection: SeedConnection,
	slide: SlideDimensions,
	region: NormalizedRegion | null = null,
): AnnotationPayload {
	const from = projectToMapCoordinates(preNeuron, slide, region);
	const to = projectToMapCoordinates(postNeuron, slide, region);
	return {
		label: `FlyWire - ${preNeuron.label} → ${postNeuron.label}`,
		notes: `${connection.synapses} synapse${connection.synapses === 1 ? '' : 's'} · neurotransmitter: ${connection.neurotransmitter ?? 'unknown'}`,
		colour: colourForNeurotransmitter(connection.neurotransmitter),
		shape: 'arrow',
		lineStyle: 'solid',
		lineThickness: lineThicknessForSynapses(connection.synapses),
		geoJson: JSON.stringify({
			type: 'Feature',
			geometry: { type: 'LineString', coordinates: [[from.x, from.y], [to.x, to.y]] },
			properties: {},
		}),
	};
}

export {
	projectToMapCoordinates,
	colourForSuperClass,
	colourForNeurotransmitter,
	lineThicknessForSynapses,
	buildAnnotationPayload,
	buildCellCountPayload,
	buildPathwayPayload,
	countConnectionsFor,
	describeNeuron,
};
export type { SlideDimensions, MapCoordinate, AnnotationPayload, CellCountPayload };
