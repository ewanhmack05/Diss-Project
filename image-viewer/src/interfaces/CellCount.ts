interface CellCountDot {
	x: number;
	y: number;
	colour: string;
}

interface CellCountColourCount {
	colour: string;
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
	// tallies, but there's no dot to record.
	dots: string;
	withAnnotation: boolean;
	withRoi: boolean;
	count: number;
	dotSize: number;
	locationX: number | null;
	locationY: number | null;
	regionOfInterest: RegionOfInterest | null;
	created: string;
}

export type { CellCount, CellCountDot, CellCountColourCount, RegionOfInterest };
