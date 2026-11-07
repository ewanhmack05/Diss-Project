import assert from "node:assert/strict";
import { test } from "node:test";
import { readProbe, sideBySideArgs, singleArgs, videoProblems } from "../lib/video.js";

test("a single video is cut before decoding and saved as a playable h264 mp4", () => {
	const args = singleArgs("in.webm", "out.mp4", 5470);
	assert.ok(args.indexOf("-ss") < args.indexOf("-i"));
	assert.equal(args[args.indexOf("-ss") + 1], "5.470");
	assert.equal(args[args.indexOf("-c:v") + 1], "libx264");
	assert.equal(args[args.indexOf("-pix_fmt") + 1], "yuv420p");
	assert.equal(args.at(-1), "out.mp4");
});

test("a negative skip is treated as none", () => {
	const args = singleArgs("in.webm", "out.mp4", -50);
	assert.equal(args[args.indexOf("-ss") + 1], "0.000");
});

test("side by side gives each recording its own skip, in order", () => {
	const args = sideBySideArgs(["a.webm", "b.webm"], "out.mp4", [9000, 3250]);
	assert.deepEqual(args.slice(3, 9), ["-ss", "9.000", "-i", "a.webm", "-ss", "3.250"]);
	assert.equal(args[args.indexOf("b.webm") - 1], "-i");
	assert.ok(args[args.indexOf("-filter_complex") + 1].includes("hstack=inputs=2"));
});

const GOOD = JSON.stringify({
	format: { duration: "23.24", size: "4041786" },
	streams: [{ codec_type: "video", codec_name: "h264", width: 1600, height: 900 }],
});

test("reads what ffprobe reports", () => {
	assert.deepEqual(readProbe(GOOD), { seconds: 23.24, bytes: 4041786, codec: "h264", width: 1600, height: 900 });
});

test("a file with no video stream reads as empty", () => {
	const info = readProbe(JSON.stringify({ format: {}, streams: [{ codec_type: "audio" }] }));
	assert.equal(info.codec, null);
	assert.equal(info.seconds, 0);
});

const EXPECTED = { width: 1600, height: 900, minSeconds: 5 };

test("a good video has no problems", () => {
	assert.deepEqual(videoProblems(readProbe(GOOD), EXPECTED), []);
});

test("the wrong codec, size or length is each reported", () => {
	const bad = { codec: "vp9", width: 800, height: 600, seconds: 1, bytes: 1 };
	const problems = videoProblems(bad, EXPECTED);
	assert.equal(problems.length, 3);
	assert.match(problems[0], /vp9/);
	assert.match(problems[1], /800x600/);
	assert.match(problems[2], /1\.0s/);
});
