// Which slide a link is for - ?slide= in the address, next to ?invite=.

const SLIDE_PARAM = "slide";

// What a slide's id can look like. It comes off the address bar and goes
// into the tiler's path, so anything that could be more than a name is out.
const SLIDE_ID_SHAPE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/;

function isSlideId(text: string | null | undefined): text is string {
	return !!text && SLIDE_ID_SHAPE.test(text);
}

// The slide the address asks for. Null if it doesn't say, or says something
// that can't be one - the viewer then opens the one it was given.
function slideFromSearch(search: string): string | null {
	const asked = new URLSearchParams(search).get(SLIDE_PARAM)?.trim();
	return isSlideId(asked) ? asked : null;
}

// The same query with the slide in it, everything else left as it was. The
// slide the viewer starts on is left off, so that address stays the plain one.
function searchWithSlide(search: string, slideId: string, startSlideId: string): string {
	const params = new URLSearchParams(search);
	if (slideId === startSlideId) params.delete(SLIDE_PARAM);
	else params.set(SLIDE_PARAM, slideId);
	const query = params.toString();
	return query ? `?${query}` : "";
}

export { isSlideId, slideFromSearch, searchWithSlide };
