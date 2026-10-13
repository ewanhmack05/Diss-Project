// Who placed a dot - only set on dots from a shared count.
interface DotPlacer {
	userId: string;
	name: string;
}

interface CellCountDot {
	x: number;
	y: number;
	colour: string;
	placedBy?: DotPlacer;
}

interface CellCountColourCount {
	colour: string;
	count: number;
}

interface PlacedByCount extends DotPlacer {
	count: number;
}

// ROI box a count was taken within, as GeoJson. Own model on the backend,
// linked one-to-one to its CellCount. Null unless withRoi was on.
interface RegionOfInterest {
	id: string;
	geoJson: string;
	created: string;
}

interface CellCount {
	id: string;
	label: string;
	notes: string;
	// JSON-encoded CellCountDot[] - a plain string column, same convention
	// as Annotation's geoJson field on the backend. Use parseCellCountDots
	// (components/cell-count/CellCountDots) rather than JSON.parse-ing this
	// directly. Empty for a click made with withAnnotation off - it still
	// tallies, but there's no dot to record. Null when it hasn't been loaded:
	// annotation-store's list leaves the dots out (they can run to tens of
	// megabytes) and sends colourCounts / placedByCounts instead, so a count
	// from the Saved list only has its dots once it's viewed on the map.
	dots: string | null;
	// The dots' colour and placed-by counts, from the list. Use countSummary
	// (CellCountDots) - it falls back to the dots for a count that didn't
	// come from the list, e.g. one you just saved.
	colourCounts?: CellCountColourCount[];
	placedByCounts?: PlacedByCount[];
	withAnnotation: boolean;
	withRoi: boolean;
	count: number;
	dotSize: number;
	locationX: number | null;
	locationY: number | null;
	regionOfInterest: RegionOfInterest | null;
	created: string;
	// Who saved it (the host, for a shared count - dots say who placed them).
	// Set by annotation-store from their token; missing from before sign-in.
	createdById?: string;
	createdByName?: string;
}

export type { CellCount, CellCountDot, CellCountColourCount, PlacedByCount, RegionOfInterest, DotPlacer };
