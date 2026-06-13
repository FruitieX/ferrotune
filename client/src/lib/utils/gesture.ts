/**
 * Shared gesture utilities for swipe-to-close sheets and drawers.
 */

/**
 * Release pointer capture after a drag gesture. On Android Tauri
 * (WebView), framer-motion's drag handler doesn't always release pointer
 * capture on fast swipes, so the browser routes the next tap to the
 * drag-capturing element (the sheet), swallowing it. Explicitly
 * releasing the capture for any pointer IDs the drag element or event
 * target has captured drops the ghost tap.
 *
 * `dragElement` should be the draggable container (the element whose
 * `drag` prop is set). Framer Motion captures the pointer on that
 * container even when the touch started on a child, so releasing capture
 * only on `event.target` isn't always enough.
 *
 * Safe to call on any platform — on desktop browsers and platforms
 * where pointer capture wasn't set, `hasPointerCapture` returns false
 * and the call is a no-op.
 */
export function releaseDragPointerCapture(
  event: MouseEvent | TouchEvent | PointerEvent,
  dragElement?: Element | null,
) {
  const targets = new Set<Element>(
    [dragElement, event.currentTarget, event.target].filter(
      (t): t is Element =>
        t != null && typeof (t as Element).hasPointerCapture === "function",
    ),
  );
  for (const target of targets) {
    // In practice only one pointer is active during a single-finger swipe,
    // but we check the most common IDs to be safe.
    for (let id = 0; id < 5; id++) {
      if (target.hasPointerCapture(id)) {
        target.releasePointerCapture(id);
      }
    }
  }
}
