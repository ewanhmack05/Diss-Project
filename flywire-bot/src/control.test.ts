import { describe, expect, it } from 'vitest';
import { applyControlPatch, defaultControlState, normalizeRegion, resolveActiveSlideId } from './control';

describe('defaultControlState', () => {
	it('starts with both activities enabled, no region, and no slide - matches the bot\'s original always-on behaviour', () => {
		expect(defaultControlState()).toEqual({ annotationsEnabled: true, cellCountEnabled: true, region: null, slideId: null });
	});

	it('starts with the given initial slideId when one is passed', () => {
		expect(defaultControlState('003')).toEqual({ annotationsEnabled: true, cellCountEnabled: true, region: null, slideId: '003' });
	});
});

describe('resolveActiveSlideId', () => {
	it('uses the control state\'s slideId when one has been reported', () => {
		expect(resolveActiveSlideId({ annotationsEnabled: true, cellCountEnabled: true, region: null, slideId: '003' }, '000')).toBe('003');
	});

	it('falls back to the bot\'s own default before any browser has reported in', () => {
		expect(resolveActiveSlideId({ annotationsEnabled: true, cellCountEnabled: true, region: null, slideId: null }, '000')).toBe('000');
	});
});

describe('normalizeRegion', () => {
	it('passes through a well-formed region unchanged', () => {
		expect(normalizeRegion({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 })).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
	});

	it('treats null as "clear the region"', () => {
		expect(normalizeRegion(null)).toBeNull();
	});

	it('clamps a region that slightly overshoots [0,1] instead of rejecting it', () => {
		const result = normalizeRegion({ x: 0.5, y: 0.25, width: 0.8, height: 0.9 });
		expect(result).toEqual({ x: 0.5, y: 0.25, width: 0.5, height: 0.75 });
	});

	it('clamps negative x/y up to 0', () => {
		expect(normalizeRegion({ x: -0.5, y: -0.5, width: 0.2, height: 0.2 })).toEqual({ x: 0, y: 0, width: 0.2, height: 0.2 });
	});

	it('rejects a region with a missing field', () => {
		expect(normalizeRegion({ x: 0.1, y: 0.2, width: 0.3 })).toBeUndefined();
	});

	it('rejects a region with a non-numeric field', () => {
		expect(normalizeRegion({ x: 0.1, y: 0.2, width: 'wide', height: 0.4 })).toBeUndefined();
	});

	it('rejects a region that clamps down to zero-or-negative width/height', () => {
		expect(normalizeRegion({ x: 1, y: 1, width: 0.5, height: 0.5 })).toBeUndefined();
	});

	it('rejects something that is not an object at all', () => {
		expect(normalizeRegion('not a region')).toBeUndefined();
		expect(normalizeRegion(42)).toBeUndefined();
	});
});

describe('applyControlPatch', () => {
	const base = defaultControlState();

	it('changes only the fields present in the patch', () => {
		const result = applyControlPatch(base, { annotationsEnabled: false });
		expect(result).toEqual({ annotationsEnabled: false, cellCountEnabled: true, region: null, slideId: null });
	});

	it('applies multiple fields from one patch', () => {
		const result = applyControlPatch(base, { cellCountEnabled: false, region: { x: 0, y: 0, width: 0.5, height: 0.5 } });
		expect(result).toEqual({ annotationsEnabled: true, cellCountEnabled: false, region: { x: 0, y: 0, width: 0.5, height: 0.5 }, slideId: null });
	});

	it('sets the slideId', () => {
		const result = applyControlPatch(base, { slideId: '003' });
		expect(result).toEqual({ ...base, slideId: '003' });
	});

	it('a later report for a different slide overwrites the previous one', () => {
		const withSlide = applyControlPatch(base, { slideId: '003' })!;
		expect(applyControlPatch(withSlide, { slideId: '001' })).toEqual({ ...base, slideId: '001' });
	});

	it('returns null for an empty-string slideId', () => {
		expect(applyControlPatch(base, { slideId: '' })).toBeNull();
	});

	it('returns null for a non-string slideId', () => {
		expect(applyControlPatch(base, { slideId: 3 })).toBeNull();
		expect(applyControlPatch(base, { slideId: null })).toBeNull();
	});

	it('an empty patch changes nothing', () => {
		expect(applyControlPatch(base, {})).toEqual(base);
	});

	it('clearing the region with { region: null } works', () => {
		const withRegion: typeof base = { ...base, region: { x: 0, y: 0, width: 0.5, height: 0.5 } };
		expect(applyControlPatch(withRegion, { region: null })).toEqual({ ...base, region: null });
	});

	it('returns null for a non-boolean annotationsEnabled rather than silently coercing it', () => {
		expect(applyControlPatch(base, { annotationsEnabled: 'yes' })).toBeNull();
	});

	it('returns null for a non-boolean cellCountEnabled', () => {
		expect(applyControlPatch(base, { cellCountEnabled: 1 })).toBeNull();
	});

	it('returns null for a malformed region', () => {
		expect(applyControlPatch(base, { region: { x: 'left' } })).toBeNull();
	});

	it('returns null for a patch that is not an object', () => {
		expect(applyControlPatch(base, null)).toBeNull();
		expect(applyControlPatch(base, 'nope')).toBeNull();
		expect(applyControlPatch(base, [1, 2, 3])).not.toBeNull(); // an array is typeof 'object' with no matching keys - a no-op patch, not an error
	});

	it('never mutates the state object passed in', () => {
		const original = defaultControlState();
		const snapshot = { ...original };
		applyControlPatch(original, { annotationsEnabled: false });
		expect(original).toEqual(snapshot);
	});
});
