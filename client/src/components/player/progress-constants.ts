/**
 * Progress UI updates do not need to run at the display refresh rate. The
 * CSS transition between these updates keeps the indicator moving smoothly
 * while avoiding a React render (or canvas redraw) for every animation frame.
 */
export const PROGRESS_UPDATE_INTERVAL_MS = 250;
