// The arithmetic behind measure-depth.js, kept apart so it can be tested.

// Frame times from requestAnimationFrame's timestamps: frames a second, and the
// median and 95th percentile gap between frames, to a tenth of a millisecond.
export function frameStats(times) {
	if (times.length < 2) return { fps: 0, median: 0, p95: 0 };
	const gaps = times
		.slice(1)
		.map((t, i) => t - times[i])
		.sort((a, b) => a - b);
	const at = (q) => gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))];
	const tenth = (n) => Math.round(n * 10) / 10;
	return { fps: tenth((gaps.length * 1000) / (times.at(-1) - times[0])), median: tenth(at(0.5)), p95: tenth(at(0.95)) };
}

// When a step was sharp: the last tile in before a gap of quietMs with none.
// Offsets are ms from the click. Nothing fetched is sharp at once - the tiles
// were already there.
export function quietAfter(offsets, quietMs) {
	const sorted = [...offsets].sort((a, b) => a - b);
	let last = 0;
	for (const at of sorted) {
		if (at - last > quietMs && last > 0) break;
		last = at;
	}
	return Math.round(last);
}
