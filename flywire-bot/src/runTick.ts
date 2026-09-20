import type { AnnotationStoreConfig } from './annotationStore/client';
import { postAnnotation, postCellCount } from './annotationStore/client';
import {
	buildAnnotationPayload,
	buildCellCountPayload,
	buildPathwayPayload,
	countConnectionsFor,
	type SlideDimensions,
} from './annotationStore/payloads';
import type { BotControlState } from './control';
import type { BotEvent } from './liveServer';
import type { SeedFile, SeedNeuron } from './data/seed';
import { actionForTick, pickConnectionForTick, pickNeuronForTick } from './scheduler';

interface TickContext {
	config: AnnotationStoreConfig;
	collectionId: string;
	slide: SlideDimensions;
	seed: Pick<SeedFile, 'neurons' | 'connections'>;
	// Built once by the caller (bot.ts) from seed.neurons, keyed by id -
	// every connection's preId/postId is guaranteed present by construction
	// (aggregateConnections only keeps connections between sampled neurons),
	// so a pathway tick can look either end up in O(1) rather than scanning
	// seed.neurons per tick.
	neuronsById: ReadonlyMap<string, SeedNeuron>;
	// A live reference, not a snapshot - bot.ts's control endpoint mutates
	// this same object in place (see control.ts's applyControlPatch), so
	// every tick reads whatever the panel most recently set, without
	// runTick needing its own subscription mechanism.
	control: BotControlState;
	log: (message: string) => void;
	// Fired after a successful post, with the exact same tick/subject just
	// persisted to annotation-store - the live 3D connectome panel's "fire"
	// animation and the point a human would eventually see saved never
	// disagree about what happened. Optional so existing callers/tests that
	// don't care about the live feed don't need to supply a no-op.
	onEvent?: (event: BotEvent) => void;
}

function requireNeuron(neuronsById: ReadonlyMap<string, SeedNeuron>, id: string): SeedNeuron {
	const neuron = neuronsById.get(id);
	if (!neuron) throw new Error(`runTick: connection references neuron "${id}" not present in seed.neurons - seed.json is inconsistent`);
	return neuron;
}

// One unit of "the bot did something" - picks the tick's action kind (see
// scheduler.ts: annotation, cellCount, or pathway) and its subject (a
// neuron for the first two, a synaptic connection for the third), builds
// the matching payload, and posts it through the same public
// annotation-store contract image-viewer itself uses. Deliberately takes
// its dependencies as plain parameters (config, a log function) rather than
// reading process.env/console directly, so a test can swap in a mock
// poster/logger without touching global state.
//
// annotation/cellCount ticks are skipped entirely (no post, no onEvent) when
// their control flag is off - pathway ticks are never gated, since they're
// what drives the live 3D connectome view regardless of whether the 2D
// slide overlay's two activities are currently switched on.
async function runTick(tick: number, context: TickContext): Promise<void> {
	const action = actionForTick(tick);
	const timestamp = new Date().toISOString();
	const region = context.control.region;

	if (action === 'pathway') {
		const connection = pickConnectionForTick(context.seed.connections, tick);
		const pre = requireNeuron(context.neuronsById, connection.preId);
		const post = requireNeuron(context.neuronsById, connection.postId);
		const payload = buildPathwayPayload(pre, post, connection, context.slide, region);
		await postAnnotation(context.config, context.collectionId, payload);
		context.log(`[tick ${tick}] pathway - ${payload.label}`);
		context.onEvent?.({ type: 'pathway', tick, preId: connection.preId, postId: connection.postId, timestamp });
		return;
	}

	if (action === 'annotation' && !context.control.annotationsEnabled) {
		context.log(`[tick ${tick}] annotation - skipped (disabled)`);
		return;
	}
	if (action === 'cellCount' && !context.control.cellCountEnabled) {
		context.log(`[tick ${tick}] cell count - skipped (disabled)`);
		return;
	}

	const neuron = pickNeuronForTick(context.seed.neurons, tick);
	const connectionCount = countConnectionsFor(neuron.id, context.seed.connections);

	if (action === 'annotation') {
		const payload = buildAnnotationPayload(neuron, context.slide, connectionCount, region);
		await postAnnotation(context.config, context.collectionId, payload);
		context.log(`[tick ${tick}] annotation - ${payload.label}`);
		context.onEvent?.({ type: 'annotation', tick, neuronId: neuron.id, timestamp });
	} else {
		const payload = buildCellCountPayload(neuron, context.slide, connectionCount, region);
		await postCellCount(context.config, context.collectionId, payload);
		context.log(`[tick ${tick}] cell count - ${payload.label}`);
		context.onEvent?.({ type: 'cellCount', tick, neuronId: neuron.id, timestamp });
	}
}

export { runTick };
export type { TickContext };
