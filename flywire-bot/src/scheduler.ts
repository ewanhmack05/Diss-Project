import type { SeedConnection, SeedNeuron } from './data/seed';

type ActionKind = 'annotation' | 'cellCount' | 'pathway';

const ACTION_CYCLE: readonly ActionKind[] = ['annotation', 'cellCount', 'pathway'];

// Cycles deterministically rather than via Math.random() - the seed data
// itself already supplies all the real variety (position, cell type,
// neurotransmitter, connectivity), so there's nothing here that benefits
// from being nondeterministic, and a fixed cycle makes a run's behaviour
// reproducible and testable.
function actionForTick(tick: number): ActionKind {
	return ACTION_CYCLE[tick % ACTION_CYCLE.length];
}

// Cycles through the sampled neuron list indefinitely - a long-running demo
// process outlives any one pass through the seed, and wrapping around (never
// running out) is exactly the "still going" liveness the bot exists to show.
function pickNeuronForTick(neurons: readonly SeedNeuron[], tick: number): SeedNeuron {
	if (neurons.length === 0) throw new Error('pickNeuronForTick: seed has no neurons to pick from');
	return neurons[tick % neurons.length];
}

// Same wraparound as pickNeuronForTick, over the sampled connection list -
// used on a 'pathway' tick to pick which synaptic connection to draw.
function pickConnectionForTick(connections: readonly SeedConnection[], tick: number): SeedConnection {
	if (connections.length === 0) throw new Error('pickConnectionForTick: seed has no connections to pick from');
	return connections[tick % connections.length];
}

export { actionForTick, pickNeuronForTick, pickConnectionForTick };
export type { ActionKind };
