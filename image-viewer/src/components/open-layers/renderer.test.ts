import { describe, expect, it } from "vitest";
import { annotationRenderer } from "./renderer";

describe("annotationRenderer", () => {
	it("is WebGL unless the address asks otherwise", () => {
		expect(annotationRenderer("")).toBe("webgl");
		expect(annotationRenderer("?invite=abc")).toBe("webgl");
		expect(annotationRenderer("?renderer=webgl")).toBe("webgl");
	});

	it("is canvas when asked", () => {
		expect(annotationRenderer("?renderer=canvas")).toBe("canvas");
		expect(annotationRenderer("?invite=abc&renderer=canvas")).toBe("canvas");
	});

	it("falls back to WebGL for anything it does not know", () => {
		expect(annotationRenderer("?renderer=webgpu")).toBe("webgl");
		expect(annotationRenderer("?renderer=")).toBe("webgl");
	});
});
