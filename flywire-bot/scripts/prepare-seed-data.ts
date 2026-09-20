import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { aggregateConnections, parseConnectionsIpc } from '../src/data/connections';
import { normalizeCoordinates, parseNeuronCandidates, sampleBySuperClass } from '../src/data/neurons';
import type { SeedFile } from '../src/data/seed';

const RAW_DIR = fileURLToPath(new URL('../data/raw', import.meta.url));
const OUT_PATH = fileURLToPath(new URL('../data/seed.json', import.meta.url));

// Caps chosen to keep the committed seed.json small (a few hundred KB) while
// still giving the bot a long, varied run - see flywire-bot/README.md for
// the full reasoning.
const PER_CLASS_CAP = 200;
const TARGET_NEURON_TOTAL = 1200;
const MAX_CONNECTIONS = 3000;

const CITATION =
	'Dorkenwald et al. (2024) Neuronal wiring diagram of an adult brain. Nature. ' +
	'Schlegel et al. (2024) Whole-brain annotation and multi-connectome cell typing quantifies circuit stereotypy in Drosophila. Nature. ' +
	'Data: github.com/flyconnectome/flywire_annotations and zenodo.org/records/10676866.';

function main(): void {
	console.log('Reading neuron annotations...');
	const neuronTsv = readFileSync(`${RAW_DIR}/neuron_annotations.tsv`, 'utf8');
	const candidates = parseNeuronCandidates(neuronTsv);
	console.log(`  ${candidates.length} neurons with a usable id + coordinate (of ${neuronTsv.split('\n').length - 1} rows)`);

	const sampled = sampleBySuperClass(candidates, { perClassCap: PER_CLASS_CAP, targetTotal: TARGET_NEURON_TOTAL });
	const neurons = normalizeCoordinates(sampled);
	console.log(`  sampled down to ${neurons.length} neurons across ${new Set(neurons.map((n) => n.superClass)).size} super_classes`);

	console.log('Reading proofread connections (this is the ~850MB file, may take a minute)...');
	const connectionsBuffer = readFileSync(`${RAW_DIR}/proofread_connections_783.feather`);
	const rows = parseConnectionsIpc(connectionsBuffer);
	console.log(`  ${rows.length.toLocaleString()} raw connection rows`);

	const neuronIds = new Set(neurons.map((n) => n.id));
	const connections = aggregateConnections(rows, neuronIds, { maxConnections: MAX_CONNECTIONS });
	console.log(`  ${connections.length} connections between sampled neurons (capped at ${MAX_CONNECTIONS})`);

	const seed: SeedFile = {
		meta: {
			generatedAt: new Date().toISOString(),
			source: 'FlyWire FAFB connectome (v783), public releases - no CAVE/login required',
			citation: CITATION,
			neuronCount: neurons.length,
			connectionCount: connections.length,
		},
		neurons,
		connections,
	};

	writeFileSync(OUT_PATH, JSON.stringify(seed));
	console.log(`Wrote ${OUT_PATH}`);
}

main();
