import { Chip, EitherPicker, FilterSection, FilterSheet } from "../saved/FilterSheet";
import { toggled, type Either } from "../saved/filters";
import { NO_GALLERY_FILTERS, UNKNOWN_KIND, activeGalleryFilterCount, type GalleryFacets, type GalleryFilters } from "./galleryFilters";

const KIND_LABEL: Record<string, string> = { brightfield: "Brightfield", fluorescence: "Fluorescence", [UNKNOWN_KIND]: "Not stated" };

const STACK_CHOICES: [Either, string][] = [
	["any", "Any"],
	["yes", "Z-stacks"],
	["no", "Flat"],
];

interface GalleryFilterMenuProps {
	filters: GalleryFilters;
	onChange: (filters: GalleryFilters) => void;
	facets: GalleryFacets;
	// Couldn't reach annotation-store - collections can't be filtered on.
	collectionsUnknown: boolean;
}

// The gallery's Filter button and sheet, laid out like the Saved lists' -
// kind, z-stack or not, objective, channels, collections and whether anyone's
// on it now. Counts are over every slide.
function GalleryFilterMenu({ filters, onChange, facets, collectionsUnknown }: GalleryFilterMenuProps) {
	const set = (patch: Partial<GalleryFilters>) => onChange({ ...filters, ...patch });
	return (
		<FilterSheet active={activeGalleryFilterCount(filters)} onClear={() => onChange(NO_GALLERY_FILTERS)}>
			<FilterSection title="Kind">
				<div className="saved-filter-chips">
					{facets.kinds.map(({ value, count }) => (
						<Chip key={value} className={value === UNKNOWN_KIND ? "saved-filter-chip--plain" : ""} on={filters.kinds.includes(value)} onClick={() => set({ kinds: toggled(filters.kinds, value) })}>
							{KIND_LABEL[value] ?? value}
							<span className="saved-filter-count">{count.toLocaleString()}</span>
						</Chip>
					))}
				</div>
			</FilterSection>

			<FilterSection title="Z-stack">
				{facets.zStacks === 0 && filters.stacks === "any" ? (
					<p className="saved-filter-empty">No z-stacks on this tile server.</p>
				) : (
					<EitherPicker label="Z-stack" choices={STACK_CHOICES} value={filters.stacks} onChange={(value) => set({ stacks: value })} />
				)}
			</FilterSection>

			{facets.objectives.length > 0 && (
				<FilterSection title="Objective">
					<div className="saved-filter-chips">
						{facets.objectives.map(({ value, count }) => (
							<Chip key={value} on={filters.objectives.includes(value)} onClick={() => set({ objectives: toggled(filters.objectives, value) })}>
								x{Number(value.toFixed(1))}
								<span className="saved-filter-count">{count.toLocaleString()}</span>
							</Chip>
						))}
					</div>
				</FilterSection>
			)}

			{facets.channels.length > 0 && (
				<FilterSection title="Channel">
					<div className="saved-filter-chips">
						{facets.channels.map(({ value, count }) => (
							<Chip key={value} on={filters.channels.includes(value)} onClick={() => set({ channels: toggled(filters.channels, value) })}>
								{value}
								<span className="saved-filter-count">{count.toLocaleString()}</span>
							</Chip>
						))}
					</div>
				</FilterSection>
			)}

			<FilterSection title="Collections">
				{collectionsUnknown ? (
					<p className="saved-filter-empty">Couldn't load collections.</p>
				) : (
					<EitherPicker label="Collections" value={filters.collections} onChange={(value) => set({ collections: value })} />
				)}
			</FilterSection>

			<FilterSection title="People on it now">
				<EitherPicker label="People on it now" value={filters.working} onChange={(value) => set({ working: value })} />
			</FilterSection>
		</FilterSheet>
	);
}

export default GalleryFilterMenu;
