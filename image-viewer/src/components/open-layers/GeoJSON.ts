import GeoJSONFormat from "ol/format/GeoJSON";
import type Feature from "ol/Feature";
import type Geometry from "ol/geom/Geometry";

const format = new GeoJSONFormat();

function featureToGeoJson(feature: Feature<Geometry>): string {
	return format.writeFeature(feature);
}

function geoJsonToFeature(geoJson: string): Feature<Geometry> {
	return format.readFeature(geoJson) as Feature<Geometry>;
}

export { featureToGeoJson, geoJsonToFeature };
