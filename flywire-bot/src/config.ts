import { readFileSync } from 'node:fs';
import type { AnnotationStoreConfig } from './annotationStore/client';
import type { SeedFile } from './data/seed';

interface BotConfig extends AnnotationStoreConfig {
	slideId: string;
	userId: string;
	intervalMs: number;
	seedPath: string;
	livePort: number;
}

function loadConfig(env: NodeJS.ProcessEnv, defaultSeedPath: string): BotConfig {
	return {
		annotationStoreUrl: env.ANNOTATION_STORE_URL ?? 'http://localhost:5252',
		tilerUrl: env.TILER_URL ?? 'http://localhost:5095',
		slideId: env.SLIDE_ID ?? '003',
		// Same placeholder every real browser session resolves to today (see
		// image-viewer/src/context/CollectionContext.tsx) - the bot writes
		// into that same collection on purpose, so its output actually shows
		// up in the one view that exists rather than an isolated collection
		// nothing in the UI can display yet.
		userId: env.BOT_USER_ID ?? '001',
		intervalMs: Number(env.BOT_INTERVAL_MS ?? 1000),
		seedPath: env.SEED_PATH ?? defaultSeedPath,
		livePort: Number(env.BOT_LIVE_PORT ?? 5300),
	};
}

function loadSeed(seedPath: string): SeedFile {
	const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as SeedFile;
	if (seed.neurons.length === 0) {
		throw new Error(`${seedPath} has no neurons - run "npm run prepare-data" first`);
	}
	return seed;
}

export { loadConfig, loadSeed };
export type { BotConfig };
