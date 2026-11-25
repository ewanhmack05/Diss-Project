import type { DocState } from "./realtime";
import { SharedFields } from "./sharedFields";
import { TEXT_FIELDS, type TextField, type TextNow } from "./ownText";

// A form open in this viewer.
interface OpenFields {
	put: (field: string, value: string, was: string) => void;
}

interface PutTextTransport {
	openDoc: (docId: string, seed: Uint8Array) => Promise<DocState | null>;
	sendDocUpdate: (docId: string, update: Uint8Array) => void;
	closeDoc: (docId: string) => void;
	// This viewer's own open forms.
	openFields: Map<string, OpenFields>;
}

// A row's text that's been put back, and what it said before. One box can have
// been and not the other.
interface TextBack {
	docId: string;
	now: Partial<TextNow>;
	was: Partial<TextNow>;
}

// Text that's been put back, into a form anyone has open. Only done by whoever
// put it back - two people doing it would put it in twice. Nobody else's form
// saves over it meanwhile, as they only save their own typing (see ownText.ts).
async function putInDoc({ openDoc, sendDocUpdate, closeDoc, openFields }: PutTextTransport, { docId, now, was }: TextBack): Promise<void> {
	const open = openFields.get(docId);
	const fields = TEXT_FIELDS.filter((field) => now[field] !== undefined && was[field] !== undefined);
	if (open) {
		for (const field of fields) open.put(field, now[field]!, was[field]!);
		return;
	}
	const copy = new SharedFields<TextField>(TEXT_FIELDS, { label: "", notes: "", ...now });
	try {
		const state = await copy.connect({ open: (seed) => openDoc(docId, seed), send: (update) => sendDocUpdate(docId, update) });
		// Seeded means nobody had it open.
		if (state && !state.seeded) for (const field of fields) copy.put(field, now[field]!, was[field]);
	} finally {
		copy.dispose();
		// Unless our own form has opened it meanwhile.
		if (!openFields.has(docId)) closeDoc(docId);
	}
}

// From annotation-store's answer. Null is a box that wasn't changed.
interface TextWas {
	id: string;
	label: string | null;
	notes: string | null;
}

// What to put in which forms - only the boxes that were changed, so someone
// typing in the other one carries on.
function textToPut(
	entity: "annotation" | "cellCount",
	now: { id: string; label: string; notes?: string | null }[],
	textWas: TextWas[] = [],
): TextBack[] {
	const byId = new Map(now.map((row) => [row.id, row]));
	return textWas.flatMap(({ id, label, notes }) => {
		const row = byId.get(id);
		if (!row) return [];
		return [
			{
				docId: `${entity}:${id}`,
				now: { label: row.label, notes: row.notes ?? "" },
				was: { ...(label !== null ? { label } : {}), ...(notes !== null ? { notes } : {}) },
			},
		];
	});
}

export { putInDoc, textToPut };
export type { OpenFields, PutTextTransport, TextBack, TextWas };
