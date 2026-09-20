import { fileURLToPath } from 'node:url';
import { ensureCollection, fetchSlideInfo } from './annotationStore/client';
import { resolveActiveSlideId } from './control';
import { loadConfig, loadSeed } from './config';
import { startLiveServer } from './liveServer';
import { runTick } from './runTick';

async function main(): Promise<void> {
	const defaultSeedPath = fileURLToPath(new URL('../data/seed.json', import.meta.url));
	const config = loadConfig(process.env, defaultSeedPath);
	const seed = loadSeed(config.seedPath);

	console.log(`FlyWire bot starting: slide "${config.slideId}", ${seed.neurons.length} neurons, ${seed.connections.length} connections`);
	console.log(`Source: ${seed.meta.source}`);
	console.log(`Citation: ${seed.meta.citation}`);

	const [initialCollection, initialSlide, liveServer] = await Promise.all([
		ensureCollection(config, config.slideId, config.userId),
		fetchSlideInfo(config, config.slideId),
		startLiveServer(seed, config.livePort, config.slideId),
	]);
	console.log(`Collection ready: ${initialCollection.collectionId} · slide ${initialSlide.width}x${initialSlide.height}px`);
	console.log(`Live feed: http://localhost:${liveServer.port}/seed (GET), ws://localhost:${liveServer.port} (events)`);

	const neuronsById = new Map(seed.neurons.map((neuron) => [neuron.id, neuron]));

	// Tracks whichever slide image-viewer last reported having open (see
	// BotControlContext's slideId-reporting effect and control.ts's
	// resolveActiveSlideId) - starts on config.slideId's own collection/
	// dimensions since that's what the Promise.all above already fetched,
	// and re-fetches only when the reported slide actually changes.
	let currentSlideId = config.slideId;
	let collection = initialCollection;
	let slide = initialSlide;

	async function ensureCurrentSlide(): Promise<void> {
		const desired = resolveActiveSlideId(liveServer.control, config.slideId);
		if (desired === currentSlideId) return;
		const [nextCollection, nextSlide] = await Promise.all([
			ensureCollection(config, desired, config.userId),
			fetchSlideInfo(config, desired),
		]);
		collection = nextCollection;
		slide = nextSlide;
		currentSlideId = desired;
		console.log(`Switched to slide "${desired}": collection ${collection.collectionId} · ${slide.width}x${slide.height}px`);
	}

	let tick = 0;
	const runNextTick = () => {
		ensureCurrentSlide()
			.then(() =>
				runTick(tick, {
					config,
					collectionId: collection.collectionId,
					slide,
					seed,
					neuronsById,
					control: liveServer.control,
					log: (message) => console.log(message),
					onEvent: liveServer.broadcast,
				})
			)
			.catch((error: unknown) => console.error(`[tick ${tick}] failed:`, error instanceof Error ? error.message : error))
			.finally(() => {
				tick++;
			});
	};

	runNextTick();
	const interval = setInterval(runNextTick, config.intervalMs);

	const shutdown = () => {
		clearInterval(interval);
		liveServer
			.close()
			.catch(() => undefined)
			.finally(() => {
				console.log('FlyWire bot stopped.');
				process.exit(0);
			});
	};
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
}

// This file is only ever run directly (`npm start` -> tsx src/bot.ts) and
// never imported elsewhere - tests exercise loadConfig/loadSeed/runTick/
// startLiveServer individually instead, so there's no risk of this firing
// under a test.
main().catch((error: unknown) => {
	console.error('FlyWire bot failed to start:', error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
