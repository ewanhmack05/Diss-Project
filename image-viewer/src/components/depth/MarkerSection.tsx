import { useState } from "react";
import { useSliceContext } from "../../context/SliceContext";
import { useCollectionContext } from "../../context/CollectionContext";
import { useAnnotationStoreContext } from "../../context/AnnotationStoreContext";
import { useDrawContext } from "../../context/DrawContext";
import { newId } from "../../newId";
import { isUsable, markerGeoJson, type MarkerBox } from "./markers";

// The Depth tab's Mark section, in 3D: placing a box round a feature that
// spans slices, and saving it as a rectangle annotation with its slices (see
// markers.ts). The 3D view takes the two corners; this says what to do and
// names it.
function MarkerSection({ count, locked }: { count: number; locked: boolean }) {
	const { marking, setMarking } = useSliceContext();
	const { canEdit } = useCollectionContext();
	if (!canEdit || locked) return null;

	return (
		<div className="depth-panel-slider depth-panel-marker">
			<div className="depth-panel-slider-header">
				<span>Mark</span>
			</div>
			{marking === null && (
				<div className="depth-panel-buttons">
					<button type="button" onClick={() => setMarking({ stage: "first" })}>
						Mark a box
					</button>
				</div>
			)}
			{marking && marking.stage !== "form" && (
				<>
					<p className="depth-panel-hint">
						{marking.stage === "first"
							? "Click one corner on the tissue."
							: "Now the opposite corner. Turn or cut the block first to reach another depth."}
					</p>
					<div className="depth-panel-buttons">
						<button type="button" onClick={() => setMarking(null)}>
							Cancel
						</button>
					</div>
				</>
			)}
			{marking?.stage === "form" && <MarkerForm key={JSON.stringify(marking.box)} box={marking.box} count={count} />}
		</div>
	);
}

// Naming it, and the slices it spans - from the corners, but changeable,
// since two clicks can only reach so far into the block.
function MarkerForm({ box, count }: { box: MarkerBox; count: number }) {
	const { setMarking } = useSliceContext();
	const { addAnnotation } = useAnnotationStoreContext();
	const { colour } = useDrawContext();
	const [label, setLabel] = useState("Marker");
	// Shown from 1, like the slider.
	const [from, setFrom] = useState(box.sliceFrom + 1);
	const [to, setTo] = useState(box.sliceTo + 1);
	const ranged = { ...box, sliceFrom: Math.min(from, to) - 1, sliceTo: Math.max(from, to) - 1 };
	const inVolume = from >= 1 && to >= 1 && from <= count && to <= count;
	const ok = label.trim() !== "" && inVolume && isUsable(ranged);

	const save = () => {
		if (!ok) return;
		addAnnotation({
			id: newId(),
			label: label.trim(),
			notes: "",
			colour,
			shape: "rectangle",
			lineStyle: "solid",
			lineThickness: 2,
			geoJson: markerGeoJson(ranged),
			groupId: null,
			created: new Date().toISOString(),
			sliceFrom: ranged.sliceFrom,
			sliceTo: ranged.sliceTo,
		});
		setMarking(null);
	};

	return (
		<form
			className="depth-panel-marker-form"
			onSubmit={(event) => {
				event.preventDefault();
				save();
			}}
		>
			<label className="depth-panel-field">
				<span>Label</span>
				<input type="text" value={label} maxLength={200} onChange={(event) => setLabel(event.target.value)} autoFocus />
			</label>
			<div className="depth-panel-field-row">
				<label className="depth-panel-field">
					<span>Slices from</span>
					<input type="number" min={1} max={count} value={from} onChange={(event) => setFrom(Number(event.target.value))} />
				</label>
				<label className="depth-panel-field">
					<span>to</span>
					<input type="number" min={1} max={count} value={to} onChange={(event) => setTo(Number(event.target.value))} />
				</label>
			</div>
			{!isUsable(ranged) && <p className="depth-panel-note">Too small - click two corners further apart.</p>}
			{!inVolume && <p className="depth-panel-note">Slices go from 1 to {count}.</p>}
			<div className="depth-panel-buttons">
				<button type="submit" disabled={!ok}>
					Save
				</button>
				<button type="button" onClick={() => setMarking(null)}>
					Cancel
				</button>
			</div>
		</form>
	);
}

export default MarkerSection;
