import { describe, expect, it } from "vitest";
import { blockSize } from "./volume";
import { fragmentShader } from "./volumeShader";

// The shader only runs on a GPU, so these check its source for the rules
// that keep it from skipping layers. What it draws is checked in a browser
// (docs/zstack.md, verification log).

function constant(name: string): number {
	const match = fragmentShader.match(new RegExp(`const (?:float|int) ${name} = ([\\d.]+);`));
	if (!match) throw new Error(`no ${name} in the shader`);
	return Number(match[1]);
}

describe("the ray march", () => {
	it("never steps more than half a layer", () => {
		expect(fragmentShader).toMatch(/run = min\(run, 0\.5 \/ abs\(layersPerUnit\)\);/);
	});

	// At true depth a layer of Kartasalo's liver is far thinner than a step,
	// which is how the flicker happened: the ray stepped over whole sections.
	it("is needed: at true depth a liver layer is 5x thinner than a step", () => {
		const [, , depth] = blockSize(32384, 31872, 52, 0.46, 1, 5);
		const layer = depth / 52;
		const step = 1 / 600;
		expect(step / layer).toBeGreaterThan(4.5);
	});

	it("has room in the loop for every sample plus two turns a layer, for 260 layers", () => {
		expect(constant("MAX_STEPS")).toBeGreaterThanOrEqual(constant("MAX_SAMPLES") + 2 * 260);
	});
});
