import GeoJSONFormat from "ol/format/GeoJSON";
import type Feature from "ol/Feature";
import type Geometry from "ol/geom/Geometry";

const format = new GeoJSONFormat();

// Slide pixels to a tenth - full doubles (88734.88763302466) nearly
// double what the map has to load, and a tenth of a pixel never shows.
export const CoordinateDecimals = 1;

function featureToGeoJson(feature: Feature<Geometry>): string {
	return format.writeFeature(feature, { decimals: CoordinateDecimals });
}

function geoJsonToFeature(geoJson: string): Feature<Geometry> {
	return format.readFeature(geoJson) as Feature<Geometry>;
}

export { featureToGeoJson, geoJsonToFeature };
