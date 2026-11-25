import { useEffect, useRef, useState } from "react";
import { useAnnotationStoreContext } from "../../../context/AnnotationStoreContext";
import type { Annotation } from "../../../interfaces/Annotation";
import { setAnnotationRenderProperties } from "../../open-layers/Styles";
import { throttle } from "../../realtime/realtime";
import { useSharedText } from "../../realtime/useSharedText";
import EditingWith from "../../realtime/EditingWith";
import { LABEL_MAX, NOTES_MAX } from "../../realtime/autosave";
import { newChangeSet } from "../bulk";
import ColourPicker from "../../colour-picker/ColourPicker";
import DockedCard from "../../toolbar/DockedCard";
import SliceRangeCard from "./SliceRangeCard";
import "../FreeForm/AnnotationForm.css";

interface SavedAnnotationEditProps {
	annotation: Annotation;
	onBack: () => void;
}

// Colour goes out while you drag the custom picker so everyone else sees it
// change.
const COLOUR_MS = 200;

// Label and notes are shared live (see useSharedText), so two people can
// type in the same box at once. Everything saves as it changes - there's
// no Save button, because with several people in here "unsaved" would mean
// something different for each of them.
function SavedAnnotationEdit({ annotation, onBack }: SavedAnnotationEditProps) {
	const { annotationsSource, storedText, updateAnnotation, deleteAnnotation } = useAnnotationStoreContext();
	const [colour, setColour] = useState(annotation.colour);

	// Every save while the form's open is one change - one row in History,
	// from how it was when the form opened to how it was when it closed.
	const [changeSet] = useState(newChangeSet);
	// Read by the saves, which outlive any one render.
	const colourRef = useRef({ latest: annotation.colour, saved: annotation.colour });
	const updateRef = useRef(updateAnnotation);
	useEffect(() => {
		updateRef.current = updateAnnotation;
	});

	const { values, editors, fieldProps, edit, cancel } = useSharedText({
		docId: `annotation:${annotation.id}`,
		id: annotation.id,
		label: annotation.label,
		notes: annotation.notes ?? "",
		stored: storedText,
		save: (text, options) => {
			colourRef.current.saved = colourRef.current.latest;
			return updateRef.current(annotation.id, colourRef.current.latest, text, changeSet, options);
		},
	});

	const [saveColour] = useState(() =>
		throttle(() => {
			const { latest, saved } = colourRef.current;
			if (latest === saved) return;
			colourRef.current.saved = latest;
			void updateRef.current(annotation.id, latest, edit, changeSet);
		}, COLOUR_MS),
	);

	// Closing the form, however it happens, saves whatever's still waiting.
	useEffect(() => () => saveColour.flush(), [saveColour]);

	// Someone else changed the colour - follow it, unless it's just our own
	// save coming back round.
	useEffect(() => {
		if (annotation.colour === colourRef.current.saved) return;
		colourRef.current = { latest: annotation.colour, saved: annotation.colour };
		setColour(annotation.colour);
	}, [annotation.colour]);

	const handleColourChange = (next: string) => {
		setColour(next);
		colourRef.current.latest = next;
		const feature = annotationsSource.getFeatureById(annotation.id);
		if (feature) {
			feature.set("colour", next);
			setAnnotationRenderProperties(feature);
		}
		saveColour();
	};

	const handleDelete = () => {
		cancel();
		saveColour.cancel();
		deleteAnnotation(annotation.id);
		onBack();
	};

	return (
		<div className="annotation-form">
			<DockedCard className="annotation-form-field-card">
				<label className="annotation-form-field">
					Label
					<input type="text" maxLength={LABEL_MAX} {...fieldProps("label")} />
				</label>
				{!values.label.trim() && <p className="annotation-form-hint">A label is needed, so the last one is kept for now.</p>}
			</DockedCard>

			<DockedCard className="annotation-form-field-card annotation-form-notes-card">
				<label className="annotation-form-field">
					Notes
					<textarea maxLength={NOTES_MAX} rows={3} placeholder="Add any thoughts on this annotation" {...fieldProps("notes")} />
				</label>
			</DockedCard>

			<DockedCard title="Colour" className="annotation-form-colour-card">
				<ColourPicker value={colour} onChange={handleColourChange} />
			</DockedCard>

			<SliceRangeCard annotation={annotation} changeSet={changeSet} />

			<DockedCard title="Actions" className="annotation-form-actions-card">
				<div className="annotation-form-actions annotation-form-actions--stacked">
					<button type="button" className="annotation-form-button annotation-form-button--primary" onClick={onBack}>
						Done
					</button>
					<button type="button" className="annotation-form-button annotation-form-button--danger" data-cy="delete-button" onClick={handleDelete}>
						Delete
					</button>
				</div>
				<p className="annotation-form-hint">Changes save as you go.</p>
				<EditingWith editors={editors} />
			</DockedCard>
		</div>
	);
}

export default SavedAnnotationEdit;
