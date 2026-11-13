import type { ChangeEvent } from "react";
import { useSliceContext } from "../../context/SliceContext";
import { useNavigationContext } from "../../context/NavigationContext";
import { gapsAround, sliceLabel } from "./slices";
import { ASSUMED_SECTION_MICRONS, type CutAxis } from "./volume";
import "./DepthPanel.css";

const CUTS: { axis: CutAxis; label: string }[] = [
	{ axis: "none", label: "None" },
	{ axis: "x", label: "X" },
	{ axis: "y", label: "Y" },
	{ axis: "z", label: "Z" },
	{ axis: "diagonal", label: "Diagonal" },
];

function numberFrom(event: ChangeEvent<HTMLInputElement>): number | null {
	const value = Number(event.target.value);
	return Number.isFinite(value) ? value : null;
}

// Moving through a volume's slices, flat or as a block. Only offered when
// the slide has more than one slice (see Toolbar).
function DepthPanel() {
	const { slices, current, defaultSlice, showSlice, step, view, setView, settings, changeSettings, resetCamera } = useSliceContext();
	const { following, mode } = useNavigationContext();
	// In Present the host moves everyone - the same lock as panning.
	const locked = following && mode === "present";
	const count = slices.length;
	const gaps = gapsAround(slices, current);

	return (
		<div className="depth-panel">
			<div className="depth-panel-views" role="group" aria-label="View">
				<button type="button" className={view === "2d" ? "depth-panel-view--on" : ""} aria-pressed={view === "2d"} onClick={() => setView("2d")}>
					2D
				</button>
				<button type="button" className={view === "3d" ? "depth-panel-view--on" : ""} aria-pressed={view === "3d"} onClick={() => setView("3d")}>
					3D
				</button>
			</div>

			<div className="depth-panel-slider">
				<div className="depth-panel-slider-header">
					<span>{sliceLabel(current, count)}</span>
				</div>
				<input
					type="range"
					min={0}
					max={count - 1}
					step={1}
					value={current}
					onChange={(event) => {
						const value = numberFrom(event);
						if (value !== null) showSlice(value);
					}}
					disabled={locked}
					aria-label="Slice"
					aria-valuetext={sliceLabel(current, count)}
				/>
				{/* One mark per slice, under the slider. A gap is a break in the row. */}
				<div className="depth-panel-marks" aria-hidden="true">
					{slices.map((slice) => (
						<span
							key={slice.index}
							className={[
								"depth-panel-mark",
								slice.gapBefore ? "depth-panel-mark--gap" : "",
								slice.index === current ? "depth-panel-mark--current" : "",
								slice.index === defaultSlice ? "depth-panel-mark--default" : "",
							]
								.filter(Boolean)
								.join(" ")}
						/>
					))}
				</div>
			</div>

			<div className="depth-panel-buttons">
				<button type="button" onClick={() => step(-1)} disabled={locked || current === 0} title="Previous slice (Page Up)">
					Previous
				</button>
				<button type="button" onClick={() => step(1)} disabled={locked || current === count - 1} title="Next slice (Page Down)">
					Next
				</button>
				<button type="button" onClick={() => showSlice(defaultSlice)} disabled={locked || current === defaultSlice}>
					Back to {defaultSlice + 1}
				</button>
			</div>

			{(gaps.before || gaps.after) && (
				<p className="depth-panel-note">
					{gaps.before && gaps.after
						? "Gaps either side of this slice - the cuts next to it are missing."
						: gaps.before
							? "Gap before this slice - the cuts between it and the last are missing."
							: "Gap after this slice - the cuts between it and the next are missing."}{" "}
					Across a gap the slices are only lined up by the tissue's outline.
				</p>
			)}

			{view === "3d" && (
				<div className="depth-panel-block">
					<div className="depth-panel-slider">
						<div className="depth-panel-slider-header">
							<span>Slices drawn</span>
							<span className="depth-panel-value">
								{settings.firstSlice + 1} to {settings.lastSlice + 1}
							</span>
						</div>
						<input
							type="range"
							min={0}
							max={count - 1}
							value={settings.firstSlice}
							aria-label="First slice drawn"
							onChange={(event) => {
								const value = numberFrom(event);
								if (value !== null) changeSettings({ firstSlice: Math.min(value, settings.lastSlice) });
							}}
						/>
						<input
							type="range"
							min={0}
							max={count - 1}
							value={settings.lastSlice}
							aria-label="Last slice drawn"
							onChange={(event) => {
								const value = numberFrom(event);
								if (value !== null) changeSettings({ lastSlice: Math.max(value, settings.firstSlice) });
							}}
						/>
					</div>

					<div className="depth-panel-slider">
						<div className="depth-panel-slider-header">
							<span>Cut</span>
						</div>
						<div className="depth-panel-cuts" role="group" aria-label="Cut">
							{CUTS.map(({ axis, label }) => (
								<button
									key={axis}
									type="button"
									className={settings.cut === axis ? "depth-panel-view--on" : ""}
									aria-pressed={settings.cut === axis}
									onClick={() => changeSettings({ cut: axis })}
								>
									{label}
								</button>
							))}
						</div>
						{settings.cut !== "none" && (
							<input
								type="range"
								min={0}
								max={1}
								step={0.01}
								value={settings.cutPosition}
								aria-label="Where the cut is"
								onChange={(event) => {
									const value = numberFrom(event);
									if (value !== null) changeSettings({ cutPosition: value });
								}}
							/>
						)}
					</div>

					<div className="depth-panel-slider">
						<div className="depth-panel-slider-header">
							<span>Opacity</span>
							<span className="depth-panel-value">{Math.round(settings.opacity * 100)}%</span>
						</div>
						<input
							type="range"
							min={0.05}
							max={1}
							step={0.05}
							value={settings.opacity}
							aria-label="Opacity"
							onChange={(event) => {
								const value = numberFrom(event);
								if (value !== null) changeSettings({ opacity: value });
							}}
						/>
					</div>

					<div className="depth-panel-slider">
						<div className="depth-panel-slider-header">
							<span>Depth</span>
							<span className="depth-panel-value">x{settings.stretch.toFixed(2).replace(/\.?0+$/, "")}</span>
						</div>
						<input
							type="range"
							min={0.25}
							max={4}
							step={0.25}
							value={settings.stretch}
							aria-label="Depth"
							onChange={(event) => {
								const value = numberFrom(event);
								if (value !== null) changeSettings({ stretch: value });
							}}
						/>
					</div>

					<label className="depth-panel-check">
						<input type="checkbox" checked={settings.guides} onChange={(event) => changeSettings({ guides: event.target.checked })} />
						Outline and grid
					</label>

					<div className="depth-panel-buttons">
						<button type="button" onClick={resetCamera}>
							Reset view
						</button>
					</div>

					<p className="depth-panel-hint">
						Drag to turn it, scroll to zoom, right-drag to move it. Click the tissue to open that slice there in 2D.
					</p>
				</div>
			)}

			{view === "2d" && (
				<p className="depth-panel-hint">
					{locked ? "The presenter is choosing the slice." : "Page Up and Page Down, or Shift and scroll on the slide."}
				</p>
			)}
		</div>
	);
}

export default DepthPanel;
