export const DEFAULTS = {
	url: "https://localhost:5173",
	keycloak: "http://localhost:8080/auth",
	realm: "diss",
	adminUser: "admin",
	adminPassword: "admin",
	out: "videos",
};

const VALUE_FLAGS = {
	"--url": "url",
	"--keycloak": "keycloak",
	"--realm": "realm",
	"--admin-user": "adminUser",
	"--admin-password": "adminPassword",
	"--out": "out",
};

export function parseArgs(argv) {
	const options = { ...DEFAULTS, only: [], list: false, clean: false, headed: false, help: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--list") options.list = true;
		else if (arg === "--clean") options.clean = true;
		else if (arg === "--headed") options.headed = true;
		else if (arg === "--help" || arg === "-h") options.help = true;
		else if (arg === "--only") {
			while (argv[i + 1] && !argv[i + 1].startsWith("--")) options.only.push(argv[++i]);
			if (options.only.length === 0) throw new Error("--only needs at least one scene");
		} else if (VALUE_FLAGS[arg]) {
			if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`${arg} needs a value`);
			options[VALUE_FLAGS[arg]] = argv[++i];
		} else throw new Error(`Don't know ${arg} - try --help`);
	}
	options.url = options.url.replace(/\/+$/, "");
	options.keycloak = options.keycloak.replace(/\/+$/, "");
	return options;
}

// Recording one scene shouldn't forget the others, and a scene that's since
// worked isn't failed any more. Kept in scene order.
export function mergeManifest(existing, result, order, at) {
	const videos = (existing?.videos ?? []).filter((video) => video.scene !== result.scene);
	const failed = (existing?.failed ?? []).filter((name) => name !== result.scene);
	if (result.failed) failed.push(result.scene);
	else videos.push(result);
	videos.sort((a, b) => order.indexOf(a.scene) - order.indexOf(b.scene));
	return { ...existing, recordedAt: at, videos, failed };
}

// Under this much free memory, recording is what tips a machine over.
export const MIN_FREE_BYTES = 4 * 1024 ** 3;

export function enoughMemory(freeBytes, needed = MIN_FREE_BYTES) {
	return freeBytes >= needed;
}

// The scenes asked for, in the order they're defined, so a run reads the same
// however --only was typed.
export function pickScenes(scenes, only) {
	if (only.length === 0) return scenes;
	const known = new Set(scenes.map((scene) => scene.name));
	const unknown = only.filter((name) => !known.has(name));
	if (unknown.length) {
		throw new Error(`No scene called ${unknown.join(", ")} - there's ${[...known].join(", ")}`);
	}
	return scenes.filter((scene) => only.includes(scene.name));
}
