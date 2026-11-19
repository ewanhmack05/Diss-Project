import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { placeSheet, samePlacement, type SheetPlacement, type Side } from "./sheetPlacement";
import type { Either } from "./filters";
import "./SavedFilterMenu.css";
import Icon from "../../icons/Icon";
import chevronDownSvg from "../../icons/chevron-down.svg?raw";
import chevronLeftSvg from "../../icons/chevron-left.svg?raw";
import chevronRightSvg from "../../icons/chevron-right.svg?raw";
import chevronUpSvg from "../../icons/chevron-up.svg?raw";
import filterSvg from "../../icons/filter.svg?raw";

function panelOf(toggle: HTMLElement): HTMLElement {
	return toggle.closest<HTMLElement>(".draggable-panel") ?? toggle;
}

// The sheet's place and the panel's text size, so it reads at the same scale.
interface Frame {
	placement: SheetPlacement;
	fontSize: string;
}

function frameFor(toggle: HTMLElement): Frame {
	const panel = panelOf(toggle);
	return {
		placement: placeSheet(panel.getBoundingClientRect(), toggle.getBoundingClientRect(), {
			width: window.innerWidth,
			height: window.innerHeight,
		}),
		fontSize: getComputedStyle(panel).fontSize,
	};
}

// The close arrow points back towards the button or panel.
const CLOSE_ICON: Record<Side, string> = { right: chevronLeftSvg, left: chevronRightSvg, below: chevronUpSvg, above: chevronDownSvg };

function FilterSection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="saved-filter-section">
			<h3 className="saved-filter-section-title">{title}</h3>
			{children}
		</section>
	);
}

function Chip({
	on,
	onClick,
	children,
	label,
	className = "",
}: {
	on: boolean;
	onClick: () => void;
	children: ReactNode;
	label?: string;
	className?: string;
}) {
	return (
		<button
			type="button"
			className={`saved-filter-chip${on ? " saved-filter-chip--on" : ""} ${className}`}
			aria-pressed={on}
			aria-label={label}
			title={label}
			onClick={onClick}
		>
			{children}
		</button>
	);
}

const WITH_WITHOUT: [Either, string][] = [
	["any", "Any"],
	["yes", "With"],
	["no", "Without"],
];

// Any / With / Without as one joined control - or other words for the same
// three, like Any / Z-stacks / Flat.
function EitherPicker({
	value,
	onChange,
	label,
	choices = WITH_WITHOUT,
}: {
	value: Either;
	onChange: (value: Either) => void;
	label: string;
	choices?: [Either, string][];
}) {
	return (
		<div className="saved-filter-either" role="group" aria-label={label}>
			{choices.map(([choice, text]) => (
				<button
					key={choice}
					type="button"
					className={`saved-filter-either-option${value === choice ? " saved-filter-either-option--on" : ""}`}
					aria-pressed={value === choice}
					onClick={() => onChange(choice)}
				>
					{text}
				</button>
			))}
		</div>
	);
}

interface FilterSheetProps {
	// How many filters are on - the badge, and whether Clear all does anything.
	active: number;
	onClear: () => void;
	children: ReactNode;
}

// A Filter button, and the sheet it opens against the panel's side (see
// sheetPlacement). Changes apply as they're made, with the list still in
// view; the badge says how many are on. What's in the sheet is up to the list.
function FilterSheet({ active, onClear, children }: FilterSheetProps) {
	const [frame, setFrame] = useState<Frame | null>(null);
	const toggleRef = useRef<HTMLButtonElement>(null);
	const popupRef = useRef<HTMLDivElement>(null);
	const open = frame !== null;
	const close = () => setFrame(null);

	// Follows the panel while it's open - dragged, resized, docked somewhere
	// else or the window resized. Checked each frame rather than with
	// observers, since a drag moves the panel without resizing anything.
	useEffect(() => {
		if (!open) return;
		let raf = 0;
		const follow = () => {
			const toggle = toggleRef.current;
			if (toggle) {
				const next = frameFor(toggle);
				setFrame((current) => (current && samePlacement(current.placement, next.placement) && current.fontSize === next.fontSize ? current : next));
			}
			raf = requestAnimationFrame(follow);
		};
		raf = requestAnimationFrame(follow);
		return () => cancelAnimationFrame(raf);
	}, [open]);

	// An outside click or Escape closes it. The panel counts as inside - the
	// point of having it beside the list is being able to use the list too.
	useEffect(() => {
		if (!open) return;
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			const toggle = toggleRef.current;
			if (popupRef.current?.contains(target) || (toggle && panelOf(toggle).contains(target))) return;
			setFrame(null);
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setFrame(null);
		};
		window.addEventListener("pointerdown", handlePointerDown);
		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("pointerdown", handlePointerDown);
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [open]);

	const placement = frame?.placement;
	const popupStyle: CSSProperties = placement
		? {
				left: placement.left,
				top: placement.top ?? undefined,
				bottom: placement.bottom ?? undefined,
				width: placement.width,
				minHeight: placement.minHeight ?? undefined,
				maxHeight: placement.maxHeight,
				fontSize: frame.fontSize,
			}
		: {};

	return (
		<>
			<button
				ref={toggleRef}
				type="button"
				className={`saved-filter-toggle${active > 0 ? " saved-filter-toggle--active" : ""}`}
				aria-expanded={open}
				aria-haspopup="dialog"
				aria-label={active > 0 ? `Filter, ${active} on` : "Filter"}
				title="Filter"
				onClick={() => (open ? close() : setFrame(frameFor(toggleRef.current!)))}
			>
				<Icon svg={filterSvg} size={12} />
				<span className="saved-filter-toggle-text">Filter</span>
				{active > 0 && <span className="saved-filter-badge">{active}</span>}
			</button>

			{open &&
				createPortal(
					<div ref={popupRef} className={`saved-filter-popup saved-filter-popup--${placement?.side}`} style={popupStyle} role="dialog" aria-label="Filters">
						<header className="saved-filter-popup-header">
							Filters
							<button type="button" className="saved-filter-popup-close" aria-label="Close filters" onClick={close}>
								<Icon svg={CLOSE_ICON[placement?.side ?? "right"]} size={12} />
							</button>
						</header>
						<div className="saved-filter-popup-body themed-scroll">{children}</div>
						<footer className="saved-filter-popup-footer">
							<button type="button" className="saved-filter-footer-button" disabled={active === 0} onClick={onClear}>
								Clear all
							</button>
							<button type="button" className="saved-filter-footer-button saved-filter-footer-button--primary" onClick={close}>
								Done
							</button>
						</footer>
					</div>,
					document.body,
				)}
		</>
	);
}

export { Chip, EitherPicker, FilterSection, FilterSheet };
