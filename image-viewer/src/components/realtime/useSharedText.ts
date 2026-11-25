import { useEffect, useRef, useState } from "react";
import { useRealtimeContext } from "../../context/RealtimeContext";
import { TextEdit, TEXT_FIELDS, type SaveOptions, type TextField } from "./ownText";
import type { StoredText } from "./storedText";
import { TextSaves } from "./textSaves";
import { useSharedFields } from "./useSharedFields";

interface SharedTextOptions {
	docId: string;
	// The row's, and what it said when the form opened.
	id: string;
	label: string;
	notes: string;
	stored: StoredText;
	// Saves what edit has to save (see saveText). Resolves false if the store
	// turned it down on the way, having got it in since or not.
	save: (edit: TextEdit, options: SaveOptions) => Promise<{ turnedDown: boolean }>;
}

// A label and notes shared with everyone who has the same form open, each
// saving only their own typing (see ownText.ts). Everything saves on a pause,
// and on closing.
function useSharedText({ docId, id, label, notes, stored, save }: SharedTextOptions) {
	const { me } = useRealtimeContext();
	const [edit] = useState(() => new TextEdit({ label, notes }, stored.sinceNow(), stored.ats(id)));
	const saveRef = useRef(save);
	const aloneRef = useRef(true);
	const leadsRef = useRef(true);
	const putRef = useRef<(field: TextField, value: string) => void>(() => {});
	const savesRef = useRef<TextSaves | null>(null);

	const [saves] = useState(
		() =>
			new TextSaves(
				edit,
				(options) => {
					void saveRef.current(edit, options).then(({ turnedDown }) => {
						if (turnedDown) savesRef.current?.storedChanged();
					});
				},
				() => {
					if (!leadsRef.current) return;
					for (const [field, text] of Object.entries(edit.putRight(aloneRef.current))) putRef.current(field as TextField, text);
				},
			),
	);

	const { values, editors, fieldProps, put } = useSharedFields(
		docId,
		TEXT_FIELDS,
		{ label, notes },
		(_, change) => {
			edit.changed(change.field, change);
			saves.changed(change);
		},
		(field, chars) => edit.opened(field, chars),
	);

	useEffect(() => {
		saveRef.current = save;
		putRef.current = put;
		aloneRef.current = editors.every((editor) => editor === me?.connectionId);
		// Two people putting it right would put it in twice.
		leadsRef.current = editors.every((editor) => me && editor >= me.connectionId);
	});

	useEffect(
		() =>
			stored.subscribe(id, (text, when) => {
				edit.storedNow(text, when);
				saves.storedChanged();
			}),
		[stored, id, edit, saves],
	);

	// Closing the form, however it happens, saves whatever's still waiting.
	useEffect(() => {
		savesRef.current = saves;
		return () => {
			savesRef.current = null;
			saves.close(aloneRef.current);
		};
	}, [saves]);

	// edit's for a save that's the rest of the row as well as text. cancel is
	// for when what's being edited goes.
	return { values, editors, fieldProps, edit, cancel: () => saves.cancel() };
}

export { useSharedText };
