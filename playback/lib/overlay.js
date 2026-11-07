// Runs in every page of a recording. Video capture doesn't include the mouse
// pointer, so this draws one, plus a caption saying what's going on. Neither
// takes pointer events, so the app can't tell they're there.
export function installOverlay() {
	const ready = () => {
		const pointer = document.createElement("div");
		pointer.id = "playback-pointer";
		pointer.style.cssText =
			"position:fixed;left:0;top:0;width:24px;height:24px;z-index:2147483647;pointer-events:none;" +
			"transform:translate(-100px,-100px);will-change:transform;";
		pointer.innerHTML =
			'<svg width="24" height="24" viewBox="0 0 24 24"><path d="M3 2 L3 19 L8 15 L11.5 22 L14.5 20.5 L11 14 L18 14 Z" ' +
			'fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>';

		const ring = document.createElement("div");
		ring.id = "playback-ring";
		ring.style.cssText =
			"position:fixed;left:-16px;top:-16px;width:32px;height:32px;border-radius:50%;z-index:2147483646;" +
			"pointer-events:none;border:3px solid #ffb300;opacity:0;transform:translate(-100px,-100px);";

		const caption = document.createElement("div");
		caption.id = "playback-caption";
		caption.style.cssText =
			// Low down - the viewer's own toasts come up at the top.
			"position:fixed;left:50%;bottom:54px;transform:translateX(-50%);z-index:2147483645;pointer-events:none;" +
			"background:rgba(20,20,20,.86);color:#fff;font:600 17px/1.3 system-ui,sans-serif;padding:8px 16px;" +
			"border-radius:8px;max-width:80vw;text-align:center;opacity:0;transition:opacity .2s;";

		document.documentElement.append(ring, pointer, caption);

		const place = (event) => {
			const at = `translate(${event.clientX}px,${event.clientY}px)`;
			pointer.style.transform = at;
			ring.style.transform = at;
		};
		window.addEventListener("pointermove", place, true);
		window.addEventListener("mousemove", place, true);
		window.addEventListener(
			"pointerdown",
			(event) => {
				place(event);
				ring.style.opacity = "1";
			},
			true,
		);
		const release = () => {
			ring.style.opacity = "0";
		};
		window.addEventListener("pointerup", release, true);
		window.addEventListener("pointercancel", release, true);

		window.__playbackCaption = (text) => {
			caption.textContent = text;
			caption.style.opacity = text ? "1" : "0";
		};
	};
	if (document.documentElement && document.readyState !== "loading") ready();
	else document.addEventListener("DOMContentLoaded", ready, { once: true });
}
