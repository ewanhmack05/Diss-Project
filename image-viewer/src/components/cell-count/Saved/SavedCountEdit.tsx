import { useEffect, useRef, useState } from "react";
import { useCellCountStoreContext } from "../../../context/CellCountStoreContext";
import type { CellCount } from "../../../interfaces/CellCount";
import { useSharedText } from "../../realtime/useSharedText";
import { LABEL_MAX, NOTES_MAX } from "../../realtime/autosave";
import { newChangeSet } from "../../annotation/bulk";
import EditingWith from "../../realtime/EditingWith";
import { countSummary } from "../CellCountDots";
import CountedBy from "../CountedBy";
import CellCountColourSwatch from "../CellCountColourSwatch";
import DockedCard from "../../toolbar/DockedCard";
import "../CellCounter/CellCountForm.css";

interface SavedCountEditProps {
	cellCount: CellCount;
	onBack: () => void;
}

// Same as SavedAnnotationEdit: label and notes are shared live, so several
// people can type in them at once, and everything saves as it changes.
// Only label/notes are editable - colour breakdown, withAnnotation/withRoi
// and count/dot size are facts about how the session was counted. They
// still ride along in the PUT body unchanged (the endpoint overwrites
// whatever it's given), just not as editable fields.
function SavedCountEdit({ cellCount, onBack }: SavedCountEditProps) {
	const { storedText, updateCellCount, deleteCellCount } = useCellCountStoreContext();

	// Read by the save, which outlives any one render.
	const { withAnnotation, withRoi, count, dotSize } = cellCount;
	const factsRef = useRef({ withAnnotation, withRoi, count, dotSize });
	// Every save while the form's open is one change - see SavedAnnotationEdit.
	const [changeSet] = useState(newChangeSet);
	const updateRef = useRef(updateCellCount);
	useEffect(() => {
		updateRef.current = updateCellCount;
		factsRef.current = { withAnnotation, withRoi, count, dotSize };
	});

	const { values, editors, fieldProps, cancel } = useSharedText({
		docId: `cellCount:${cellCount.id}`,
		id: cellCount.id,
		label: cellCount.label,
		notes: cellCount.notes ?? "",
		stored: storedText,
		save: (text, options) => updateRef.current(cellCount.id, factsRef.current, text, changeSet, options),
	});

	// The summary, not the dots - editing a label doesn't need them loaded.
	const { colours: colourBreakdown, people } = countSummary(cellCount);

	const handleDelete = () => {
		cancel();
		deleteCellCount(cellCount.id);
		onBack();
	};

	return (
		<div className="cell-count-form">
			<DockedCard className="cell-count-form-field-card">
				<label className="cell-count-form-field">
					Label
					<input type="text" maxLength={LABEL_MAX} {...fieldProps("label")} />
				</label>
				{!values.label.trim() && <p className="cell-count-form-hint">A label is needed, so the last one is kept for now.</p>}
			</DockedCard>

			<DockedCard className="cell-count-form-field-card cell-count-form-notes-card">
				<label className="cell-count-form-field">
					Notes
					<textarea maxLength={NOTES_MAX} rows={3} placeholder="Add any thoughts on this count" {...fieldProps("notes")} />
				</label>
			</DockedCard>

			{/* Everything below is a fact about how the session was counted, not
          something this screen lets you retype (see the comment above) -
          grouped into one Details card rather than one each, the same
          "same slot" reasoning used throughout the docked toolbars: with
          nothing else in this view sharing a row with a different card
          count, there's no resize risk in bundling them together, and it
          keeps this card list from growing much past AddCellCountForm's. */}
			<DockedCard title="Details" className="cell-count-form-details-card cell-count-form-summary-card">
				<div className="cell-count-form-field">
					Colour
					<div className="cell-count-form-static cell-count-form-colour-breakdown">
						<CellCountColourSwatch breakdown={colourBreakdown} className="cell-count-form-colour-swatch" />
						{colourBreakdown.length > 0 ? (
							colourBreakdown.map(({ colour, count: colourCount }) => (
								<span key={colour} className="cell-count-form-colour-chip">
									<span className="cell-count-form-colour-chip-swatch" style={{ backgroundColor: colour }} />
									{colourCount}
								</span>
							))
						) : (
							<span>No colour recorded</span>
						)}
					</div>
				</div>

				<CountedBy people={people} />

				<div className="cell-count-form-row">
					<div className="cell-count-form-field">
						With annotation
						<p className="cell-count-form-static">{cellCount.withAnnotation ? "Yes" : "No"}</p>
					</div>

					<div className="cell-count-form-field">
						With region of interest
						<p className="cell-count-form-static">{cellCount.withRoi ? "Yes" : "No"}</p>
					</div>
				</div>

				<div className="cell-count-form-row">
					<div className="cell-count-form-field">
						Count
						<p className="cell-count-form-static">{cellCount.count}</p>
					</div>

					<div className="cell-count-form-field">
						Dot size
						<p className="cell-count-form-static">{cellCount.dotSize}px</p>
					</div>
				</div>
			</DockedCard>

			<DockedCard title="Actions" className="cell-count-form-actions-card">
				<div className="cell-count-form-actions cell-count-form-actions--stacked">
					<button type="button" className="cell-count-form-button cell-count-form-button--primary" onClick={onBack}>
						Done
					</button>
					<button type="button" className="cell-count-form-button cell-count-form-button--danger" data-cy="delete-button" onClick={handleDelete}>
						Delete
					</button>
				</div>
				<p className="cell-count-form-hint">Changes save as you go.</p>
				<EditingWith editors={editors} />
			</DockedCard>
		</div>
	);
}

export default SavedCountEdit;
