const LABEL_MAX = 64;
const NOTES_MAX = 256;

// How long a pause in typing before a label or notes box saves. Long enough
// not to save mid-sentence, short enough that a crash loses almost nothing.
// Every save of one open form goes in one change set, so this only changes
// how often it saves, not what the history shows.
const TEXT_SAVE_MS = 1000;

export { LABEL_MAX, NOTES_MAX, TEXT_SAVE_MS };
