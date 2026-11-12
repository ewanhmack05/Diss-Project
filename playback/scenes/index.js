import * as solo from "./solo.js";
import * as together from "./together.js";
import * as gallery from "./gallery.js";

export { SLIDE } from "./helpers.js";

// cast says who's in it. Anyone who isn't sam or jo starts on a blank page, not signed in.
export const SCENES = [
	{ name: "signing-in", title: "Signing in, switching user and signing out", cast: ["visitor"], run: solo.signingIn },
	{ name: "map-navigation", title: "Moving round the slide", cast: ["sam"], run: solo.mapNavigation },
	{ name: "annotations", title: "Annotations - every shape, saving, search, filters, editing", cast: ["sam"], run: solo.annotations },
	{ name: "annotation-groups", title: "Selecting many at once, and groups", cast: ["sam"], run: solo.annotationGroups },
	{ name: "cell-counter", title: "Cell counter - every way of counting, and saved counts", cast: ["sam"], run: solo.cellCounter },
	{ name: "rotation", title: "Rotation - buttons, dial and typed angle", cast: ["sam"], run: solo.rotation },
	{ name: "ruler", title: "Ruler - measuring a distance", cast: ["sam"], run: solo.ruler },
	{ name: "image-adjustments", title: "Image adjustments - every slider and everything presets do", cast: ["sam"], run: solo.imageAdjustments },
	{ name: "tab-docking", title: "Panels - floating, every edge, sharing, closing", cast: ["sam"], run: solo.tabDocking },
	{ name: "collections", title: "Collections - renaming, sharing, import, export, paging", cast: ["sam"], run: solo.collections },
	{ name: "history", title: "History - every change, putting back, timelines, rollback", cast: ["sam"], run: solo.history },
	{ name: "gallery", title: "Gallery - moving between slides, filmstrip, docking, being asked first", cast: ["sam"], run: gallery.galleryAlone },
	{
		name: "collaboration",
		title: "Working together live - follow, present, annotations, counts, ruler, rotation, adjustments",
		cast: ["sam", "jo"],
		run: together.collaboration,
	},
	{ name: "counting-together", title: "Comparison counts and shared counts", cast: ["sam", "jo"], run: together.countingTogether },
	{ name: "session-admin", title: "Running a session - links, roles, caps, collisions, ending", cast: ["sam", "jo"], run: together.sessionAdmin },
	{ name: "messaging", title: "Messages - an annotation, a group of cell counts and a viewing area", cast: ["sam", "jo"], run: together.messaging },
	{ name: "guests", title: "Guests - joining without an account", cast: ["sam", "guest"], run: together.guests },
	{
		name: "gallery-together",
		title: "Gallery with two people - who's where, an invite to another slide, leaving the room, going after someone",
		cast: ["sam", "jo"],
		run: gallery.galleryTogether,
	},
];
