import { useEffect, useRef, useState } from "react";
import { useAnnotationStoreContext } from "../../../context/AnnotationStoreContext";
import { useSliceContext } from "../../../context/SliceContext";
import type { Annotation, SliceRange } from "../../../interfaces/Annotation";
import { debounce } from "../../realtime/realtime";
import { TEXT_SAVE_MS } from "../../realtime/autosave";
import { rangeFromInputs } from "../../depth/markers";
import DockedCard from "../../toolbar/DockedCard";

interface SliceRangeCardProps {
	annotation: Annotation;
	changeSet: string;
}

const same = (a: SliceRange, b: SliceRange) => a.sliceFrom === b.sliceFrom && a.sliceTo === b.sliceTo;

// Which slices of a volume it's on, in the Saved edit form: a 3D marker made
// deeper, or a shape put on every slice or back on one. Saves as it changes,
// like the rest of the form, once the numbers make sense.
function SliceRangeCard({ annotation, changeSet }: SliceRangeCardProps) {
	const { moveToSlices } = useAnnotationStoreContext();
	const { volume, slices, current } = useSliceContext();
	const count = slices.length;
	const stored: SliceRange = { sliceFrom: annotation.sliceFrom ?? null, sliceTo: annotation.sliceTo ?? null };
	// Shown from 1, like the slider. Kept as typed, so a half-typed number
	// isn't snapped back.
	const [from, setFrom] = useState(String((stored.sliceFrom ?? current) + 1));
	const [to, setTo] = useState(String((stored.sliceTo ?? current) + 1));
	const sentRef = useRef(stored);
	const moveRef = useRef(moveToSlices);
	useEffect(() => {
		moveRef.current = moveToSlices;
	});

	const [send] = useState(() =>
		debounce((range: SliceRange) => {
			if (same(range, sentRef.current)) return;
			sentRef.current = range;
			moveRef.current(annotation.id, range, changeSet);
		}, TEXT_SAVE_MS),
	);
	useEffect(() => () => send.flush(), [send]);

	// Someone else moved it - follow, unless it's our own move coming back.
	const { sliceFrom, sliceTo } = annotation;
	useEffect(() => {
		const now: SliceRange = { sliceFrom: sliceFrom ?? null, sliceTo: sliceTo ?? null };
		if (same(now, sentRef.current)) return;
		sentRef.current = now;
		if (now.sliceFrom !== null) setFrom(String(now.sliceFrom + 1));
		if (now.sliceTo !== null) setTo(String(now.sliceTo + 1));
	}, [sliceFrom, sliceTo]);

	if (!volume) return null;
	const everySlice = stored.sliceFrom === null;
	const range = rangeFromInputs(from, to, count);

	const typed = (nextFrom: string, nextTo: string) => {
		setFrom(nextFrom);
		setTo(nextTo);
		const next = rangeFromInputs(nextFrom, nextTo, count);
		if (next) send(next);
	};

	const setEverySlice = (on: boolean) => {
		send.cancel();
		const next: SliceRange = on ? { sliceFrom: null, sliceTo: null } : { sliceFrom: current, sliceTo: current };
		if (!on) {
			setFrom(String(current + 1));
			setTo(String(current + 1));
		}
		sentRef.current = next;
		moveToSlices(annotation.id, next, changeSet);
	};

	return (
		<DockedCard title="Slices" className="annotation-form-field-card">
			<label className="annotation-form-check">
				<input type="checkbox" checked={everySlice} onChange={(e) => setEverySlice(e.target.checked)} />
				On every slice
			</label>
			{!everySlice && (
				<div className="annotation-form-slices">
					<label className="annotation-form-field">
						From
						<input type="number" min={1} max={count} value={from} onChange={(e) => typed(e.target.value, to)} aria-label="First slice" />
					</label>
					<label className="annotation-form-field">
						To
						<input type="number" min={1} max={count} value={to} onChange={(e) => typed(from, e.target.value)} aria-label="Last slice" />
					</label>
				</div>
			)}
			{!everySlice && !range && <p className="annotation-form-hint">Slices go from 1 to {count} - the last one saved is kept for now.</p>}
		</DockedCard>
	);
}

export default SliceRangeCard;
