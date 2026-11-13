// Draws the block by ray marching: each pixel of the box's back faces casts
// a ray from the camera, finds where it's inside the box, and steps along it
// through the 3D texture, adding up colour front to back until it's solid.
// Back faces so it still draws with the camera inside the box.
//
// Texture space is the same as volume.ts's firstHit: x across the slide,
// y down it, z through the layers with layer 0 at the front (+z in the scene).
// Only what's on the kept side of the cut and inside the layer range counts,
// so a cut shows the inside of the block.

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

in vec3 vPosition;
// GLSL 3 has no gl_FragColor - the output's declared.
layout(location = 0) out highp vec4 fragColour;

const int MAX_STEPS = 1200;

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

	int steps = int(clamp((span.y - span.x) / uStep, 1.0, float(MAX_STEPS)));
	float stepLength = (span.y - span.x) / float(steps);
	vec4 colour = vec4(0.0);
	float t = span.x + 0.5 * stepLength;
	for (int i = 0; i < MAX_STEPS; i++) {
		if (i >= steps) break;
		vec3 p = textureSpace(uCamera + direction * t);
		float layer = floor(clamp(p.z, 0.0, 0.9999) * uLayers);
		if (dot(uCutNormal, p) <= uCutOffset && layer >= uFirstLayer && layer <= uLastLayer) {
			// The texture's premultiplied (see buildVolume), so filtering between a
			// tissue voxel and an empty one doesn't darken the colour.
			vec4 voxel = texture(uVolume, p);
			if (voxel.a < 0.004) {
				t += stepLength;
				continue;
			}
			float alpha = 1.0 - pow(1.0 - clamp(voxel.a * uOpacity, 0.0, 0.999), stepLength / uVoxel);
			colour.rgb += (1.0 - colour.a) * alpha * (voxel.rgb / voxel.a);
			colour.a += (1.0 - colour.a) * alpha;
			if (colour.a > 0.98) break;
		}
		t += stepLength;
	}
	if (colour.a < 0.01) discard;
	fragColour = vec4(colour.rgb / colour.a, colour.a);
}
`;

export { vertexShader, fragmentShader };
