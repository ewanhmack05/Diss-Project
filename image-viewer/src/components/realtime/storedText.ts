import type { AnnotationOp } from "./realtime";
import { TEXT_FIELDS, type TextField, type TextNow, type When } from "./ownText";

interface TextRow {
	id?: string;
	label?: string;
	notes?: string | null;
}

// What annotation-store last said each label and notes was - from loads, saves,
// other people's, and what's been put back. An open form follows its own
// (useSharedText). Not the same as what's shown, which is ahead of it while
// you type.
class StoredText {
	private readonly listeners = new Map<string, Set<(text: Partial<TextNow>, when: When) => void>>();
	// When each was, for any the store's stamped.
	private readonly storedAt = new Map<string, number>();
	// Goes up when the whole collection's put back.
	private putBacks = 0;

	// Someone else's save can be heard of after a newer one. Gives back what's
	// left of each row with any text like that taken out.
	remember<T extends TextRow>(rows: T[], when: When = {}): T[] {
		return rows.map((row) => {
			if (row.id === undefined) return row;
			const { label, notes } = row;
			const text = { ...(label !== undefined ? { label } : {}), ...(notes !== undefined ? { notes: notes ?? "" } : {}) };
			for (const listener of this.listeners.get(row.id) ?? []) listener(text, when);
			const fresh = { ...row };
			for (const field of TEXT_FIELDS) if (fresh[field] !== undefined && !this.isNewer(`${row.id} ${field}`, when.at)) delete fresh[field];
			return fresh;
		});
	}

	private isNewer(key: string, at: number | undefined): boolean {
		if (at === undefined) return true;
		if ((this.storedAt.get(key) ?? 0) >= at) return false;
		this.storedAt.set(key, at);
		return true;
	}

	// When what a form opens with was stored.
	ats(id: string): Partial<Record<TextField, number>> {
		return Object.fromEntries(TEXT_FIELDS.map((field) => [field, this.storedAt.get(`${id} ${field}`)]));
	}

	subscribe(id: string, listener: (text: Partial<TextNow>, when: When) => void): () => void {
		const listening = this.listeners.get(id) ?? new Set();
		this.listeners.set(id, listening.add(listener));
		return () => {
			listening.delete(listener);
			if (listening.size === 0 && this.listeners.get(id) === listening) this.listeners.delete(id);
		};
	}

	collectionPutBack(): void {
		this.putBacks++;
	}

	// Whether it hasn't been put back since now, asked later.
	sinceNow(): () => boolean {
		const then = this.putBacks;
		return () => this.putBacks === then;
	}
}

// When the text in one of annotation-store's answers was what's stored - see
// its EditConflicts.TextAtHeader. Nothing from a store before it.
function textAt(response: Response): number | undefined {
	const at = Number(response.headers.get("Text-At") ?? NaN);
	return Number.isFinite(at) ? at : undefined;
}

// Sent with an op so whoever hears it can tell - and taken off again, as it
// isn't part of the row.
function withWhen<T extends object>(data: T, { at, putBack, ids }: When): T {
	return {
		...data,
		...(at !== undefined ? { textAt: at } : {}),
		...(putBack ? { putBack } : {}),
		...(ids ? { textIds: Object.fromEntries(Object.entries(ids).map(([field, list]) => [field, asRuns(list)])) } : {}),
	};
}

function takeWhen(op: AnnotationOp): { op: AnnotationOp; when: When } {
	if (op.kind === "delete" || !op.data || typeof op.data !== "object") return { op, when: {} };
	const { textAt: at, putBack, textIds, ...data } = op.data as Record<string, unknown>;
	const text = data as Partial<Record<TextField, unknown>>;
	const runs = textIds && typeof textIds === "object" ? (textIds as Partial<Record<TextField, unknown>>) : {};
	const ids: When["ids"] = {};
	for (const field of TEXT_FIELDS) {
		const [list, stored] = [fromRuns(runs[field]), text[field]];
		// One for each character, or it's no use.
		if (list && typeof stored === "string" && list.length === stored.length) ids[field] = list;
	}
	return {
		op: { ...op, data },
		when: { at: typeof at === "number" ? at : undefined, putBack: putBack === true, ...(Object.keys(ids).length ? { ids } : {}) },
	};
}

// Typing comes in runs, so "8:40+12" is twelve characters from 8:40 on. One with
// no id is "+1".
function asRuns(ids: string[]): string {
	const runs: { client: string; from: number; count: number }[] = [];
	for (const id of ids) {
		const [client, clock] = id ? id.split(":") : ["", "0"];
		const last = runs[runs.length - 1];
		if (last && last.client === client && (!client || last.from + last.count === Number(clock))) last.count++;
		else runs.push({ client, from: Number(clock), count: 1 });
	}
	return runs.map(({ client, from, count }) => `${client ? `${client}:${from}` : ""}+${count}`).join(",");
}

// Longer than any box holds.
const MOST_IDS = 4096;

function fromRuns(runs: unknown): string[] | null {
	if (typeof runs !== "string") return null;
	const ids: string[] = [];
	for (const run of runs ? runs.split(",") : []) {
		const match = /^(?:(\d+):(\d+))?\+(\d+)$/.exec(run);
		if (!match) return null;
		const [, client, from, count] = match;
		if (ids.length + Number(count) > MOST_IDS) return null;
		for (let i = 0; i < Number(count); i++) ids.push(client ? `${client}:${Number(from) + i}` : "");
	}
	return ids;
}

export { StoredText, textAt, withWhen, takeWhen };
