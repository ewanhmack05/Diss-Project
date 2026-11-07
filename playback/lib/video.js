import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const ENCODE = ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];

function seconds(ms) {
	return (Math.max(0, ms) / 1000).toFixed(3);
}

// One person's recording, cut to when the scene started. Without the cut every
// video opens on the sign-in page.
export function singleArgs(input, output, skipMs) {
	return ["-y", "-v", "error", "-ss", seconds(skipMs), "-i", input, ...ENCODE, "-an", output];
}

// Two people side by side, each cut to the same moment so what one does lines
// up with what the other sees. Each recording started at its own time, hence
// a skip each.
export function sideBySideArgs(inputs, output, skipsMs) {
	return [
		"-y",
		"-v",
		"error",
		"-ss",
		seconds(skipsMs[0]),
		"-i",
		inputs[0],
		"-ss",
		seconds(skipsMs[1]),
		"-i",
		inputs[1],
		// A line down the middle, or the two screens run together on the white.
		"-filter_complex",
		"[0:v]drawbox=x=iw-3:y=0:w=3:h=ih:color=white:t=fill[left];[left][1:v]hstack=inputs=2:shortest=1[v]",
		"-map",
		"[v]",
		...ENCODE,
		"-an",
		output,
	];
}

export async function encode(args) {
	await run("ffmpeg", args, { maxBuffer: 16 * 1024 * 1024 });
}

export function readProbe(json) {
	const parsed = JSON.parse(json);
	const stream = (parsed.streams ?? []).find((s) => s.codec_type === "video");
	return {
		seconds: Number(parsed.format?.duration ?? 0),
		bytes: Number(parsed.format?.size ?? 0),
		codec: stream?.codec_name ?? null,
		width: stream?.width ?? 0,
		height: stream?.height ?? 0,
	};
}

export async function probe(file) {
	const { stdout } = await run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", file]);
	return readProbe(stdout);
}

// A file can exist and still be junk. Returns what's wrong with it, if anything.
export function videoProblems(info, { width, height, minSeconds }) {
	const problems = [];
	if (info.codec !== "h264") problems.push(`codec is ${info.codec}, not h264`);
	if (info.width !== width || info.height !== height) {
		problems.push(`size is ${info.width}x${info.height}, not ${width}x${height}`);
	}
	if (info.seconds < minSeconds) problems.push(`only ${info.seconds.toFixed(1)}s long, expected at least ${minSeconds}s`);
	return problems;
}

export async function requireTools() {
	for (const tool of ["ffmpeg", "ffprobe"]) {
		try {
			await run(tool, ["-version"]);
		} catch {
			throw new Error(`${tool} isn't on the PATH - see SETUP.md or: winget install ffmpeg`);
		}
	}
}
