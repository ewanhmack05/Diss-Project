// How saved annotations get drawn. WebGL unless the address says ?renderer=canvas,
// which is only for comparing the two - see docs/evaluation.md. Everything else on
// the map stays as it is, so the difference in the numbers is this layer's.
type AnnotationRenderer = "webgl" | "canvas";

function annotationRenderer(search: string): AnnotationRenderer {
	return new URLSearchParams(search).get("renderer") === "canvas" ? "canvas" : "webgl";
}

export { annotationRenderer };
export type { AnnotationRenderer };
