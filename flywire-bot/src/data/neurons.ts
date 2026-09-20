interface NeuronCandidate {
	id: string;
	label: string;
	superClass: string;
	side: string | null;
	neurotransmitter: string | null;
	rawX: number;
	rawY: number;
	rawZ: number;
}

interface SampleOptions {
	perClassCap: number;
	targetTotal: number;
}

function parseTsv(text: string): { headers: string[]; rows: string[][] } {
	const lines = text.split('\n').filter((line) => line.length > 0);
	const headers = lines[0]?.split('\t') ?? [];
	const rows = lines.slice(1).map((line) => line.split('\t'));
	return { headers, rows };
}

function rowsToObjects(headers: string[], rows: string[][]): Record<string, string>[] {
	return rows.map((row) => {
		const record: Record<string, string> = {};
		headers.forEach((header, index) => {
			record[header] = row[index] ?? '';
		});
		return record;
	});
}

// cell_type is the most specific human-readable label FlyWire assigns; fall
// back down the annotation hierarchy toward the coarsest field (super_class)
// so every neuron with any classification at all gets a usable label.
function pickLabel(row: Record<string, string>): string {
	const candidates = [row.cell_type, row.hemibrain_type, row.supertype, row.cell_class, row.super_class];
	const found = candidates.find((value) => value && value.trim().length > 0);
	return found ?? 'neuron';
}

// Soma position is the more meaningful "where this cell lives" point, but
// it's blank for neurons whose cell body wasn't captured in-volume (common
// for boundary-truncated visual/sensory fragments) - pos_x/y/z is FlyWire's
// own fallback seed point for exactly that case, so it's the right thing to
// fall back to rather than dropping the neuron entirely. Real 3D (not just a
// 2D projection) - z matters as much as x/y once this is rendered as an
// actual 3D point cloud rather than flattened onto a slide.
function pickCoordinates(row: Record<string, string>): { x: number; y: number; z: number } | null {
	const somaX = Number(row.soma_x);
	const somaY = Number(row.soma_y);
	const somaZ = Number(row.soma_z);
	if (row.soma_x && row.soma_y && row.soma_z && Number.isFinite(somaX) && Number.isFinite(somaY) && Number.isFinite(somaZ)) {
		return { x: somaX, y: somaY, z: somaZ };
	}
	const posX = Number(row.pos_x);
	const posY = Number(row.pos_y);
	const posZ = Number(row.pos_z);
	if (row.pos_x && row.pos_y && row.pos_z && Number.isFinite(posX) && Number.isFinite(posY) && Number.isFinite(posZ)) {
		return { x: posX, y: posY, z: posZ };
	}
	return null;
}

function toNeuronCandidate(row: Record<string, string>): NeuronCandidate | null {
	if (!row.root_id) return null;
	const coords = pickCoordinates(row);
	if (!coords) return null;
	return {
		id: row.root_id,
		label: pickLabel(row),
		superClass: row.super_class && row.super_class.trim().length > 0 ? row.super_class : 'unclassified',
		side: row.side && row.side.trim().length > 0 ? row.side : null,
		neurotransmitter: row.top_nt && row.top_nt.trim().length > 0 ? row.top_nt : null,
		rawX: coords.x,
		rawY: coords.y,
		rawZ: coords.z,
	};
}

function parseNeuronCandidates(tsvText: string): NeuronCandidate[] {
	const { headers, rows } = parseTsv(tsvText);
	const objects = rowsToObjects(headers, rows);
	const candidates: NeuronCandidate[] = [];
	for (const row of objects) {
		const candidate = toNeuronCandidate(row);
		if (candidate) candidates.push(candidate);
	}
	return candidates;
}

// Deterministic stride sampling (not random) - same input always produces
// the same seed file, and re-running prepare-seed-data.ts after a fresh
// download doesn't churn an unrelated diff. Groups by super_class first so
// the sample stays visually varied instead of whatever the source file's
// row order happens to cluster (e.g. one proofreading batch in a row).
function sampleBySuperClass(candidates: NeuronCandidate[], options: SampleOptions): NeuronCandidate[] {
	const byClass = new Map<string, NeuronCandidate[]>();
	for (const candidate of candidates) {
		const group = byClass.get(candidate.superClass) ?? [];
		group.push(candidate);
		byClass.set(candidate.superClass, group);
	}

	function evenlySpaced<T>(items: T[], count: number): T[] {
		if (items.length <= count) return items;
		const picked: T[] = [];
		for (let i = 0; i < count; i++) {
			picked.push(items[Math.floor((i * items.length) / count)]);
		}
		return picked;
	}

	const capped: NeuronCandidate[] = [];
	for (const group of byClass.values()) {
		const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
		capped.push(...evenlySpaced(sorted, options.perClassCap));
	}

	if (capped.length <= options.targetTotal) return capped;

	const sortedAll = [...capped].sort((a, b) => a.id.localeCompare(b.id));
	return evenlySpaced(sortedAll, options.targetTotal);
}

// Min-max range for one axis, guarding the degenerate all-same-value case
// (a single-candidate sample, or every point sharing a coordinate) the same
// way for every axis rather than repeating the guard three times.
function axisRange(values: number[]): { min: number; range: number } {
	const min = Math.min(...values);
	const max = Math.max(...values);
	return { min, range: max - min || 1 };
}

function normalizeCoordinates(
	candidates: NeuronCandidate[],
): Array<Omit<NeuronCandidate, 'rawX' | 'rawY' | 'rawZ'> & { x: number; y: number; z: number }> {
	if (candidates.length === 0) return [];
	const xAxis = axisRange(candidates.map((c) => c.rawX));
	const yAxis = axisRange(candidates.map((c) => c.rawY));
	const zAxis = axisRange(candidates.map((c) => c.rawZ));

	return candidates.map(({ rawX, rawY, rawZ, ...rest }) => ({
		...rest,
		x: (rawX - xAxis.min) / xAxis.range,
		y: (rawY - yAxis.min) / yAxis.range,
		z: (rawZ - zAxis.min) / zAxis.range,
	}));
}

export { parseTsv, rowsToObjects, pickLabel, pickCoordinates, toNeuronCandidate, parseNeuronCandidates, sampleBySuperClass, normalizeCoordinates };
export type { NeuronCandidate, SampleOptions };
