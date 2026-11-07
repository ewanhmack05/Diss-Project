// Everything the viewer does, from reading its components. A scene calls
// did('id') once it has done that thing, nearly always straight after checking
// it worked (see LOOKED_AT for the rest). A test fails if anything
// here has no scene, so "all functionality" is checked, not claimed. New
// feature in the viewer: add it here, and the test says it needs a scene.
export const FEATURES = {
	// Moving round the slide
	"map-pan": "Drag to pan",
	"map-wheel-zoom": "Scroll to zoom",
	"map-zoom-buttons": "The + and - buttons",
	"map-scale-bar": "Scale bar following the zoom",
	"map-overview": "Overview map showing where you are",
	"map-overview-toggle": "Collapsing the overview map",
	"map-overview-hover": "The overview map growing on hover",
	"map-overview-jump": "Clicking the overview map to go there",
	"map-keyboard": "Arrow keys to pan, + and - to zoom, once the map has focus",
	"map-double-click": "Double click to zoom",
	"map-shift-zoom": "Shift and drag a box to zoom to it",
	"map-fullscreen": "Fullscreen, by button and the F key",
	"map-drag-rotate": "Alt+Shift drag to rotate",

	// Annotations
	"draw-line": "Line",
	"draw-freehand": "Freehand",
	"draw-polygon": "Polygon",
	"draw-arrow": "Arrow",
	"draw-rectangle": "Rectangle",
	"draw-circle": "Circle",
	"draw-thickness": "Line thickness",
	"draw-dashed": "Dashed lines",
	"draw-palette": "Palette colours",
	"draw-custom-colour": "Custom colour picker",
	"draw-quick": "Quick draw - every shape saves straight away",
	"draw-redraw": "Redraw instead of saving",
	"draw-move-pending": "Dragging a shape before saving it",
	"draw-form-colour": "Changing colour on the save form",
	"saved-list": "Saved annotations list",
	"saved-search": "Searching saved annotations",
	"saved-filter-shape": "Filtering by shape",
	"saved-filter-colour": "Filtering by colour",
	"saved-filter-person": "Filtering by who saved it",
	"saved-filter-notes": "Filtering by notes",
	"saved-filter-date": "Filtering by date",
	"saved-filter-group": "Filtering by group",
	"saved-filter-clear": "Clearing filters",
	"saved-pager": "Paging through a long list",
	"saved-view": "View on map and stop viewing",
	"saved-edit": "Editing label, notes and colour",
	"saved-delete": "Deleting from the edit form",

	// Selecting and groups
	"select-box": "Picking with a box",
	"select-lasso": "Picking with a lasso",
	"select-shift": "Shift to add to what is picked",
	"select-click": "Clicking a shape in and out",
	"select-escape": "Esc to clear",
	"select-move-map": "Holding Space to move the map while selecting",
	"select-all-clear": "All and Clear",
	"select-recolour": "Recolouring what is picked",
	"select-delete-undo": "Deleting what is picked, and undo",
	"group-new": "Making a group",
	"group-add": "Adding to a group",
	"group-take-out": "Taking out of a group",
	"group-hide": "Hiding and showing a group",
	"group-select": "Picking everything in a group",
	"group-rename": "Renaming a group",
	"group-notes": "Group notes",
	"group-recolour": "Recolouring a group",
	"group-merge": "Merging groups",
	"group-delete-members": "Deleting everything in a group, and undo",
	"group-delete": "Deleting a group, keeping its annotations",

	// Cell counter
	"count-dots": "Clicking to count",
	"count-dot-size": "Dot size",
	"count-colour": "Colours, changed part way through a count",
	"count-undo-redo": "Undo and Redo buttons",
	"count-keys": "Z and Y keys for undo and redo",
	"count-history": "Click history while counting",
	"count-no-annotation": "Counting without annotation - just a tally",
	"count-recount": "Recount instead of saving",
	"count-roi": "Region of interest and its size",
	"count-roi-drag": "Dragging the region into place",
	"count-roi-cancel": "Cancelling placement",
	"count-saved": "Saved counts list",
	"count-search": "Searching saved counts",
	"count-filter": "Filtering saved counts",
	"count-view": "A saved count back on the map, and hiding it",
	"count-edit": "Editing a count",
	"count-delete": "Deleting a count",
	"count-timeline": "One count's own timeline",

	// Rotation, ruler, adjustments
	"rotate-buttons": "Quick rotate buttons",
	"rotate-dial": "Dragging the dial",
	"rotate-typed": "Typing an angle",
	"rotate-reset": "Reset",
	"ruler-measure": "Measuring between two points",
	"ruler-replace": "A new measurement replacing the last",
	"ruler-clear": "Clearing it",
	"adjust-sliders": "Brightness, contrast, gamma, red, green and blue",
	"adjust-reset": "Reset",
	"adjust-preset-save": "Saving a preset",
	"adjust-preset-apply": "Applying a preset",
	"adjust-preset-update": "Updating a preset",
	"adjust-preset-delete": "Deleting a preset",

	// Panels
	"panel-float": "Moving a floating panel",
	"panel-front": "Bringing a panel to the front",
	"panel-close": "Closing a panel, from it and the toolbar",
	"dock-left": "Docking left",
	"dock-right": "Docking right",
	"dock-top": "Docking top",
	"dock-bottom": "Docking bottom",
	"dock-share": "Two panels sharing an edge",
	"dock-undock": "Pulling a panel off again",
	"dock-close-fills": "Closing a docked panel giving its space back",
	"dock-reopen": "A closed panel reopening where it was docked",
	"dock-top-every-tab": "Every tab laid out across the top",

	// Collections and history
	"collection-rename": "Renaming your collection",
	"collection-share": "Letting others view it",
	"collection-export": "Exporting as GeoJSON",
	"collection-import": "Importing GeoJSON, with its preview",
	"collection-view-other": "Looking at someone else's shared collection",
	"history-list": "History of every change",
	"history-order": "Newest or oldest first",
	"history-filter": "Filtering history by kind",
	"history-detail": "Opening one change",
	"history-put-back": "Putting back something deleted",
	"history-item": "One annotation's timeline, and going back on it",
	"history-rollback": "Putting the whole collection back to a point",

	// Sessions
	"session-start": "Starting a session",
	"session-rename": "Renaming a session",
	"session-link": "Making and copying an invite link and code",
	"session-join-link": "Joining with a link or code",
	"session-invite-user": "Inviting someone from the Users tab",
	"session-active": "Active tab - who is in right now",
	"session-settings": "Link role, expiry and stopping a link",
	"session-cap": "Editor cap - past it, people join view only",
	"session-roles": "Changing what someone can do",
	"session-view-only": "What a view only person gets",
	"session-remove": "Taking someone out of a session",
	"session-end": "Ending a session",
	"session-ended": "An ended session being read only",
	"session-delete": "Deleting an ended session",
	"session-reopen": "A session nobody is in, and reopening it",
	"session-leave": "Leaving a session for good",

	// Working together live
	"live-presence": "Chips for who is here",
	"live-viewports": "Seeing where someone is looking, on and off",
	"live-point": "Hovering someone to pick them out",
	"live-draw": "Someone else's shape appearing as they draw it",
	"live-saved": "A saved shape reaching everyone",
	"live-shared-typing": "Two people typing in one label",
	"live-colour": "Colour changes reaching everyone",
	"live-count-private": "A count staying private until it's saved, outside Present",
	"live-count": "The host's dots and tally as they count, in Present",
	"live-ruler": "Someone else's ruler",
	"live-rotation": "Rotation following the host",
	"live-adjustments": "Image adjustments following the host, and coming back",
	"nav-free": "Free navigation",
	"nav-follow": "Follow me",
	"nav-follow-break": "Stopping following, and following again",
	"nav-present": "Present - the host's view and nobody can move away",
	"nav-present-panels": "Present - panels and tabs following the host",
	"nav-look-here": "Asking people to look here",
	"nav-open-tab": "Asking people to open a tab",
	"nav-ask-one": "Asking one person rather than everyone",
	"policy-first-wins": "First change wins, the collision and the choice",

	// Counting together
	"compare-invite": "Comparison invite, join and decline",
	"compare-count": "Counting without seeing each other",
	"compare-waiting": "Waiting on everyone to hand in",
	"compare-results": "Agreement, counts and rings round missed cells",
	"compare-save": "Saving your count from a comparison",
	"shared-invite": "Shared count invite and join",
	"shared-tally": "Everyone adding to one tally",
	"shared-undo": "Undo only taking back your own",
	"shared-double": "Rings round cells counted twice",
	"shared-leave": "Someone leaving a shared count, their dots staying",
	"shared-save": "Finishing and saving, with who counted what",

	// Accounts
	"account-sign-in": "Signing in",
	"account-switch": "Switching user",
	"account-sign-out": "Signing out",

	// Messages
	"message-send-saved": "Send on a saved row, which asks who to",
	"message-search": "Finding someone to send to",
	"message-send-annotation": "Sending an annotation",
	"message-send-count-group": "Sending a group of cell counts",
	"message-send-area": "Sending the area you're looking at",
	"message-live": "A message arriving live, with a badge and a toast",
	"message-inbox": "The list of conversations beside the thread, and opening one clearing its unread",
	"message-preview": "A preview of what was sent, in its own colours",
	"message-view": "View, taking the map there without saving anything",
	"message-view-area": "Viewing a sent area, landing where the sender was",
	"message-stop-showing": "Stop showing",
	"message-add": "Adding something sent to your collection",
	"message-add-group": "A sent group arriving as a group",
	"message-fold": "Folding the list down to a rail and back",
	"count-group-make": "Making a group of cell counts",
	"count-group-move": "Moving cell counts into a group",

	// Guests
	"guest-join": "Joining as a guest with just a name",
	"guest-view-only": "What a guest can and can't do",
	"guest-listed": "Guests listed for the host",
	"guest-ask-edit": "Asking a guest to edit",
	"guest-leave": "A guest leaving, and their name going",
};

// Real features no scene shows, and why. Said out loud so nobody reads the
// videos as covering them.
export const NOT_SHOWN = {
	"Guest name filter": "Needs a rude word on screen in a video meant for sharing. Covered by the viewer's tests",
	"+N more people chip": "Needs a large session of 7 or more. scripts/simulate_session.py is the way to try it",
	"Making an account": "Would leave a real account behind each run. It's Keycloak's own page, not the viewer",
	"Pinch zoom and rotate": "Touch only. Recording drives a mouse",
	"Reconnecting and offline states": "Needs a service stopping part way through a recording",
	"Session chat and invites as messages":
		"Left out to keep the messaging video to what's sent. Covered by the messaging service's tests, and checked by hand",
	"Send on a group of annotations, the Select tab or a collection": "The same path as the Send buttons that are shown, read when it goes",
	"Merging cell count groups, and first change wins on them":
		"Left out to keep the messaging video about messages. Covered by annotation-store's tests, and checked by hand",
};

// Done on video but with nothing in the scene checking the result, because it's
// only a look on a canvas. These were checked by eye in the frames instead, so
// they'd need looking at again after a change to them.
export const LOOKED_AT = [
	"draw-thickness",
	"draw-dashed",
	"draw-palette",
	"draw-form-colour",
	"draw-move-pending",
	"count-dot-size",
	"count-colour",
	"count-roi-drag",
	"select-recolour",
	"group-recolour",
	"map-pan",
	"map-zoom-buttons",
	"map-drag-rotate",
	"panel-float",
	"group-hide",
];

// Every did('...') in a scene's source.
export function claimedIn(source) {
	return [...source.matchAll(/\.did\(\s*["']([a-z-]+)["']/g)].map((match) => match[1]);
}

// What's on the list with no scene, and what scenes claim that isn't on it.
export function coverageGaps(claimed) {
	const seen = new Set(claimed);
	return {
		missing: Object.keys(FEATURES).filter((id) => !seen.has(id)),
		unknown: [...seen].filter((id) => !(id in FEATURES)),
	};
}
