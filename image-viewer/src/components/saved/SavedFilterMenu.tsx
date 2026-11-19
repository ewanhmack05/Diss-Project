import type { ReactNode } from "react";
import { Chip, EitherPicker, FilterSection, FilterSheet } from "./FilterSheet";
import { NO_FILTERS, NO_GROUP, PALETTE, activeFilterCount, toggled, type SavedFilters } from "./filters";
import type { SavedFacets } from "./useSavedFacets";

interface ShapeChoice {
	value: string;
	label: string;
	glyph: ReactNode;
}

// A kind of change and how many there are, for the History list.
interface KindChoice {
	kind: string;
	label: string;
	glyph: ReactNode;
	count: number;
}

// A group and how many are in it - the last one is "No group".
interface GroupChoice {
	id: string;
	name: string;
	count: number;
}

interface SavedFilterMenuProps {
	filters: SavedFilters;
	onChange: (filters: SavedFilters) => void;
	// From useSavedFacets - null while it loads.
	facets: SavedFacets | null;
	myId: string;
	// What this list can be filtered by beyond people, notes and dates -
	// annotations have shapes and colours, cell counts a region of interest.
	shapes?: ShapeChoice[];
	colours?: boolean;
	// Annotations only - the collection's groups. Left out, there's no section.
	groups?: GroupChoice[];
	roi?: boolean;
	// The History list only - kinds of change. Left out, there's no section.
	kinds?: KindChoice[];
	// What the people and the dates are of - "Saved by" and "Saved" unless
	// said otherwise.
	peopleTitle?: string;
	whenTitle?: string;
	// The History list has no notes to filter on.
	notes?: boolean;
}

// The Filter button beside a Saved list's search box, and the sheet it
// opens (see FilterSheet) - who saved it, shape, colour, notes, region of
// interest and when.
function SavedFilterMenu({
	filters,
	onChange,
	facets,
	myId,
	shapes,
	colours,
	groups,
	roi,
	kinds,
	peopleTitle = "Saved by",
	whenTitle = "Saved",
	notes = true,
}: SavedFilterMenuProps) {
	const set = (patch: Partial<SavedFilters>) => onChange({ ...filters, ...patch });

	const authors = facets?.authors ?? [];
	const me = authors.find((a) => a.id === myId);
	const people = [
		...(me ? [{ id: me.id, name: "You", count: me.count }] : []),
		...authors.filter((a) => a.id !== myId).map((a) => ({ ...a, name: a.name || "Unnamed" })),
		// Someone picked whose last save has since gone - still listed, so they
		// can be unpicked.
		...filters.createdBy.filter((id) => !authors.some((a) => a.id === id)).map((id) => ({ id, name: id === myId ? "You" : "Someone", count: 0 })),
	];
	const used = new Map((facets?.colours ?? []).map((c) => [c.colour, c.count]));
	const customCount = (facets?.colours ?? []).filter((c) => !PALETTE.includes(c.colour)).reduce((sum, c) => sum + c.count, 0);

	return (
		<FilterSheet active={activeFilterCount(filters)} onClear={() => onChange(NO_FILTERS)}>
			<FilterSection title={peopleTitle}>
				{people.length === 0 ? (
					<p className="saved-filter-empty">{facets ? "Nobody yet." : "Loading..."}</p>
				) : (
					<div className="saved-filter-chips">
						{people.map((person) => (
							<Chip key={person.id} on={filters.createdBy.includes(person.id)} onClick={() => set({ createdBy: toggled(filters.createdBy, person.id) })}>
								{person.name}
								<span className="saved-filter-count">{person.count.toLocaleString()}</span>
							</Chip>
						))}
					</div>
				)}
			</FilterSection>

			{kinds && (
				<FilterSection title="Kind">
					<div className="saved-filter-chips">
						{kinds.map((choice) => (
							<Chip key={choice.kind} on={filters.kinds.includes(choice.kind)} onClick={() => set({ kinds: toggled(filters.kinds, choice.kind) })}>
								{choice.glyph}
								{choice.label}
								<span className="saved-filter-count">{choice.count.toLocaleString()}</span>
							</Chip>
						))}
					</div>
				</FilterSection>
			)}

			{shapes && (
				<FilterSection title="Shape">
					<div className="saved-filter-shapes">
						{shapes.map((shape) => (
							<Chip
								key={shape.value}
								label={shape.label}
								className="saved-filter-chip--icon"
								on={filters.shapes.includes(shape.value)}
								onClick={() => set({ shapes: toggled(filters.shapes, shape.value) })}
							>
								{shape.glyph}
							</Chip>
						))}
					</div>
				</FilterSection>
			)}

			{colours && (
				<FilterSection title="Colour">
					<div className="saved-filter-swatches">
						{PALETTE.map((colour) => {
							const on = filters.colours.includes(colour);
							const count = used.get(colour) ?? 0;
							return (
								<button
									key={colour}
									type="button"
									className={`saved-filter-swatch${on ? " saved-filter-swatch--on" : ""}${count === 0 ? " saved-filter-swatch--unused" : ""}`}
									style={{ backgroundColor: colour }}
									aria-pressed={on}
									aria-label={`${colour.toUpperCase()}, ${count.toLocaleString()} saved`}
									title={`${colour.toUpperCase()} - ${count.toLocaleString()}`}
									onClick={() => set({ colours: toggled(filters.colours, colour) })}
								/>
							);
						})}
						<button
							type="button"
							className={`saved-filter-swatch saved-filter-swatch--custom${filters.customColour ? " saved-filter-swatch--on" : ""}${customCount === 0 ? " saved-filter-swatch--unused" : ""}`}
							aria-pressed={filters.customColour}
							aria-label={`Custom colours, ${customCount.toLocaleString()} saved`}
							title={`Custom - anything not in the palette - ${customCount.toLocaleString()}`}
							onClick={() => set({ customColour: !filters.customColour })}
						/>
					</div>
				</FilterSection>
			)}

			{groups && (
				<FilterSection title="Group">
					{groups.length === 1 ? (
						<p className="saved-filter-empty">No groups yet - make them on the Select tab.</p>
					) : (
						<div className="saved-filter-chips">
							{groups.map((group) => (
								<Chip
									key={group.id}
									className={group.id === NO_GROUP ? "saved-filter-chip--plain" : ""}
									on={filters.groups.includes(group.id)}
									onClick={() => set({ groups: toggled(filters.groups, group.id) })}
								>
									{group.name}
									<span className="saved-filter-count">{group.count.toLocaleString()}</span>
								</Chip>
							))}
						</div>
					)}
				</FilterSection>
			)}

			{notes && (
				<FilterSection title="Notes">
					<EitherPicker label="Notes" value={filters.notes} onChange={(value) => set({ notes: value })} />
				</FilterSection>
			)}

			{roi && (
				<FilterSection title="Region of interest">
					<EitherPicker label="Region of interest" value={filters.roi} onChange={(value) => set({ roi: value })} />
				</FilterSection>
			)}

			<FilterSection title={whenTitle}>
				<div className="saved-filter-dates">
					<label>
						From
						<input type="date" value={filters.from ?? ""} max={filters.to ?? undefined} onChange={(e) => set({ from: e.target.value || null })} />
					</label>
					<label>
						To
						<input type="date" value={filters.to ?? ""} min={filters.from ?? undefined} onChange={(e) => set({ to: e.target.value || null })} />
					</label>
				</div>
			</FilterSection>
		</FilterSheet>
	);
}

export default SavedFilterMenu;
