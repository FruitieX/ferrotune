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
  // Collect the drag element, the event targets, and ancestors of the drag
  // element. Capture can only live on the element that received pointerdown,
  // but on Android WebView we've seen it leak to a parent, so walking up is
  // a cheap safety net.
  const ancestors: Element[] = [];
  if (dragElement?.parentElement) {
    let node: Element | null = dragElement.parentElement;
    while (node) {
      ancestors.push(node);
      if (node === document.body) break;
      node = node.parentElement;
    }
  }

  const targets = new Set<Element>(
    [dragElement, event.currentTarget, event.target, ...ancestors].filter(
      (t): t is Element =>
        t != null && typeof (t as Element).hasPointerCapture === "function",
    ),
  );

  // Force framer-motion's drag handler to clean up its internal state.
  // On Android WebView the pointerup that ends a fast swipe can be missed
  // by the drag listener, leaving it (and its capture) active. Dispatch a
  // pointercancel/touchcancel *before* releasing capture so the handler sees
  // the cancel while the pointer is still captured (matching a real browser
  // cancel), then release, then dispatch an up/end to fully settle the
  // pointer state.
  const hasPointerId = "pointerId" in event;
  if (dragElement && typeof PointerEvent !== "undefined" && hasPointerId) {
    const pointerEvent = event as PointerEvent;
    dragElement.dispatchEvent(
      new PointerEvent("pointercancel", {
        bubbles: true,
        cancelable: false,
        pointerId: pointerEvent.pointerId,
        pointerType: pointerEvent.pointerType,
        isPrimary: pointerEvent.isPrimary,
        clientX: "clientX" in event ? (event as MouseEvent).clientX : 0,
        clientY: "clientY" in event ? (event as MouseEvent).clientY : 0,
      }),
    );
  } else if (
    dragElement &&
    typeof TouchEvent !== "undefined" &&
    event instanceof TouchEvent &&
    event.changedTouches.length > 0
  ) {
    const touch = event.changedTouches[0];
    dragElement.dispatchEvent(
      new TouchEvent("touchcancel", {
        bubbles: true,
        cancelable: false,
        changedTouches: [touch],
        touches: [],
        targetTouches: [],
      }),
    );
  }

  for (const target of targets) {
    // In practice only one pointer is active during a single-finger swipe,
    // but we check the most common IDs to be safe.
    for (let id = 0; id < 5; id++) {
      if (target.hasPointerCapture(id)) {
        target.releasePointerCapture(id);
      }
    }
  }

  if (dragElement && typeof PointerEvent !== "undefined" && hasPointerId) {
    const pointerEvent = event as PointerEvent;
    dragElement.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: false,
        pointerId: pointerEvent.pointerId,
        pointerType: pointerEvent.pointerType,
        isPrimary: pointerEvent.isPrimary,
        clientX: "clientX" in event ? (event as MouseEvent).clientX : 0,
        clientY: "clientY" in event ? (event as MouseEvent).clientY : 0,
      }),
    );
  } else if (
    dragElement &&
    typeof TouchEvent !== "undefined" &&
    event instanceof TouchEvent &&
    event.changedTouches.length > 0
  ) {
    const touch = event.changedTouches[0];
    dragElement.dispatchEvent(
      new TouchEvent("touchend", {
        bubbles: true,
        cancelable: false,
        changedTouches: [touch],
        touches: [],
        targetTouches: [],
      }),
    );
  }
}

/**
 * Stop inertial scrolling on the main scroll container and any known
 * scrollable descendants. On Android WebView, an inertial scroll can
 * continue to consume touch events for several seconds after the user
 * lifted their finger, causing the next tap on an unrelated element to
 * be swallowed. Re-issuing the current scroll offset with `auto`
 * behavior cancels the inertia.
 */
export function stopMainScrollInertia() {
  if (typeof document === "undefined") return;

  const main = document.getElementById("main-scroll-container");
  if (main) {
    main.scrollTo({ top: main.scrollTop, behavior: "auto" });
  }

  // Stop inertia on any virtualized grid/list scroll containers too.
  document.querySelectorAll("[data-scroll-container]").forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    el.scrollTo({ top: el.scrollTop, behavior: "auto" });
  });
}
