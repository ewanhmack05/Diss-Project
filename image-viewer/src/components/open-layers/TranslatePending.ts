import type Feature from "ol/Feature";
import type Geometry from "ol/geom/Geometry";
import Translate from "ol/interaction/Translate";
import type VectorLayer from "ol/layer/Vector";
import type VectorSource from "ol/source/Vector";

// Drag for the shape waiting to be named. Given `features`, Translate
// hit-tests every visible layer, and a WebGL layer with hit detection off
// throws - so the drag never started. Only the draw layer is looked at, and
// only that shape in it moves.
export function translatePending(drawLayer: VectorLayer<VectorSource> | null, feature: Feature<Geometry>): Translate {
	return new Translate({ layers: drawLayer ? [drawLayer] : [], filter: (candidate) => candidate === feature });
}
