// Draws the block by ray marching: each pixel of the box's back faces casts
// a ray from the camera, finds where it's inside the box, and steps along it
// through the 3D texture, adding up colour front to back until it's solid.
// Back faces so it still draws with the camera inside the box.
//
// Texture space is the same as volume.ts's firstHit: x across the slide,
// y down it, z through the layers with layer 0 at the front (+z in the scene).
// Only what's on the kept side of the cut and inside the layer range counts,
// so a cut shows the inside of the block.
//
// Spaced out (uSpacing above 0), each layer is a slab in the middle of its
// share of the depth - volume.ts's slabAt. Slabs can be thinner than a step,
// so the ray jumps straight across each gap to the next slab instead of
// stepping through it, and inside a slab never steps past its far side.
//
// One layer, uDetailLayer, can have a sharp picture of its own (uDetail -
// see detailSlice in volume.ts), used instead of the block wherever that
// layer's drawn. It has mipmaps, but a loop like this one gives the GPU no
// way to pick a level itself, so it's worked out from how far the ray's
// gone: how many of the picture's pixels one screen pixel covers there.
//
// An X or Y cut's face can be sharp too (uFace - see faceTier): one row per
// layer, the line of each slice the cut goes through. The first samples
// past the cut are within a step of it, so they read the face instead of
// the block. Further out a screen pixel covers so much of the face that the
// block's as good, so the face fades into it - which also keeps it from
// shimmering without mipmaps, which would blur the layers together. Each
// layer is its own band on the face, edge to edge, where the block blends
// one layer into the next.

// The box is a unit cube scaled to the block's size, so what the fragments
// need is where the vertex is in the scene, not on the unit cube - the
// camera's in scene space too.
const vertexShader = /* glsl */ `
out vec3 vPosition;

void main() {
	vPosition = (modelMatrix * vec4(position, 1.0)).xyz;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
precision highp sampler3D;

uniform sampler3D uVolume;
// The camera, in the box's own space.
uniform vec3 uCamera;
// The box's size in the scene.
uniform vec3 uSize;
uniform float uLayers;
uniform float uFirstLayer;
uniform float uLastLayer;
uniform vec3 uCutNormal;
uniform float uCutOffset;
uniform float uOpacity;
// How far each step goes, and how far one voxel across is - opacity is per
// voxel, so a finer step doesn't make it look more solid.
uniform float uStep;
uniform float uVoxel;
// The gap between slices against a slice's thickness. 0 is a solid block.
uniform float uSpacing;
uniform sampler2D uDetail;
// The layer uDetail shows, or -1 for none, and how wide it is in pixels.
uniform float uDetailLayer;
uniform float uDetailWidth;
// How wide one screen pixel is in the scene, one unit from the camera.
uniform float uPixelAngle;
uniform sampler2D uFace;
// Which layers' lines are in yet, one texel each.
uniform sampler2D uFaceReady;
// 0 for an X cut's face, 1 for a Y cut's, -1 for none; how long it is in pixels.
uniform float uFaceAxis;
uniform float uFaceLength;

in vec3 vPosition;
// GLSL 3 has no gl_FragColor - the output's declared.
layout(location = 0) out highp vec4 fragColour;

// Steps through the box, and the loop's limit - more than steps, since
// crossing a gap or the side of a slab takes a turn of its own, and so can
// each half layer (see run below): up to 520 more for 260 layers.
const float MAX_SAMPLES = 1200.0;
const int MAX_STEPS = 3072;

vec2 throughBox(vec3 origin, vec3 direction) {
	vec3 inverse = 1.0 / direction;
	vec3 a = (-0.5 * uSize - origin) * inverse;
	vec3 b = (0.5 * uSize - origin) * inverse;
	vec3 nearest = min(a, b);
	vec3 furthest = max(a, b);
	return vec2(max(max(nearest.x, nearest.y), nearest.z), min(min(furthest.x, furthest.y), furthest.z));
}

vec3 textureSpace(vec3 p) {
	vec3 t = p / uSize + 0.5;
	return vec3(t.x, 1.0 - t.y, 1.0 - t.z);
}

void main() {
	vec3 direction = normalize(vPosition - uCamera);
	vec2 span = throughBox(uCamera, direction);
	span.x = max(span.x, 0.0);
	if (span.x >= span.y) discard;

	float stepLength = (span.y - span.x) / clamp(ceil((span.y - span.x) / uStep), 1.0, MAX_SAMPLES);
	float halfSlab = 0.5 / (1.0 + uSpacing);
	// Layers crossed per unit along the ray. Texture z runs against the scene's.
	float layersPerUnit = -direction.z / uSize.z * uLayers;
	float nudge = 1e-4 / max(abs(layersPerUnit), 1e-6);
	vec4 colour = vec4(0.0);
	float t = span.x;
	for (int i = 0; i < MAX_STEPS; i++) {
		if (t >= span.y) break;
		float z = clamp(textureSpace(uCamera + direction * t).z, 0.0, 0.9999) * uLayers;
		float layer = floor(z);
		float within = z - layer - 0.5;
		float run = min(stepLength, span.y - t);
		// Never more than half a layer at a time, or a layer can be stepped
		// over. Usually a step is far thinner than a layer, but at true depth
		// a layer is 1/3000 of the block's width against a step of 1/600, so
		// the ray skipped layers - which ones changing with every move of the
		// camera, so the slices flickered and showed through each other.
		if (abs(layersPerUnit) > 1e-6) run = min(run, 0.5 / abs(layersPerUnit));
		if (uSpacing > 0.0) {
			if (abs(within) > halfSlab) {
				if (abs(layersPerUnit) < 1e-6) break;
				float next = layersPerUnit > 0.0
					? (within < 0.0 ? layer + 0.5 - halfSlab : layer + 1.5 - halfSlab)
					: (within > 0.0 ? layer + 0.5 + halfSlab : layer - 0.5 + halfSlab);
				t += (next - z) / layersPerUnit + nudge;
				continue;
			}
			if (abs(layersPerUnit) > 1e-6) {
				float side = layersPerUnit > 0.0 ? layer + 0.5 + halfSlab : layer + 0.5 - halfSlab;
				run = min(run, (side - z) / layersPerUnit + nudge);
			}
		}
		vec3 p = textureSpace(uCamera + direction * (t + 0.5 * run));
		// Spaced out, each slab is one layer of the texture, not a blend with the next.
		if (uSpacing > 0.0) p.z = (layer + 0.5) / uLayers;
		float drawn = floor(clamp(p.z, 0.0, 0.9999) * uLayers);
		if (dot(uCutNormal, p) <= uCutOffset && drawn >= uFirstLayer && drawn <= uLastLayer) {
			// The texture's premultiplied (see buildVolume), so filtering between a
			// tissue voxel and an empty one doesn't darken the colour.
			vec4 voxel;
			float away = t + 0.5 * run;
			if (drawn == uDetailLayer) {
				float lod = log2(max(away * uPixelAngle * uDetailWidth, 1.0));
				voxel = textureLod(uDetail, p.xy, lod);
			} else {
				voxel = texture(uVolume, p);
				if (uFaceAxis >= 0.0) {
					bool x = uFaceAxis < 0.5;
					// How far in from the cut, in the scene.
					float inside = (uCutOffset - dot(uCutNormal, p)) * (x ? uSize.x : uSize.y);
					// Face pixels per screen pixel: up to 2 is all face, 4 and up all block.
					float covered = away * uPixelAngle * uFaceLength / (x ? uSize.y : uSize.x);
					float weight = inside < 1.5 * uStep ? 1.0 - smoothstep(1.0, 2.0, log2(max(covered, 1.0))) : 0.0;
					// The middle of this layer's row, not a blend with the next: there's
					// nothing measured between sections, and next to each other they're
					// only lined up to tens of microns, so a blend smears cells.
					float row = (drawn + 0.5) / uLayers;
					if (weight > 0.0) weight *= texture(uFaceReady, vec2(0.5, row)).a;
					if (weight > 0.0) voxel = mix(voxel, texture(uFace, vec2(x ? p.y : p.x, row)), weight);
				}
			}
			if (voxel.a >= 0.004) {
				float alpha = 1.0 - pow(1.0 - clamp(voxel.a * uOpacity, 0.0, 0.999), run / uVoxel);
				colour.rgb += (1.0 - colour.a) * alpha * (voxel.rgb / voxel.a);
				colour.a += (1.0 - colour.a) * alpha;
				if (colour.a > 0.98) break;
			}
		}
		t += run;
	}
	if (colour.a < 0.01) discard;
	fragColour = vec4(colour.rgb / colour.a, colour.a);
}
`;

export { vertexShader, fragmentShader };
