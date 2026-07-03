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

export type GestureAxis = "horizontal" | "vertical";

let activeGestureAxis: GestureAxis | null = null;
const frozenScrollElements = new Map<
  HTMLElement,
  { overflowY: string; touchAction: string }
>();

export function claimGestureAxis(axis: GestureAxis) {
  activeGestureAxis = axis;
}

export function getClaimedGestureAxis(): GestureAxis | null {
  return activeGestureAxis;
}

export function releaseGestureAxisSoon(axis?: GestureAxis) {
  if (typeof window === "undefined") {
    activeGestureAxis = null;
    return;
  }

  window.setTimeout(() => {
    if (axis && activeGestureAxis !== axis) return;
    activeGestureAxis = null;
  }, 0);
}

export function getDominantGestureAxis(
  offsetX: number,
  offsetY: number,
  currentAxis: GestureAxis | null,
  options: { minDistance?: number; dominanceRatio?: number } = {},
): GestureAxis | null {
  if (currentAxis) return currentAxis;

  const minDistance = options.minDistance ?? 12;
  const dominanceRatio = options.dominanceRatio ?? 1.25;
  const absX = Math.abs(offsetX);
  const absY = Math.abs(offsetY);

  if (Math.max(absX, absY) < minDistance) return null;
  if (absX >= absY * dominanceRatio) return "horizontal";
  if (absY >= absX * dominanceRatio) return "vertical";
  return null;
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

export function stopScrollInertiaAfterGesture(extra?: () => void) {
  if (typeof window === "undefined") return;

  const scrollElements = getKnownScrollElements();
  freezeScrollElements(scrollElements);

  const stop = () => {
    stopMainScrollInertia();
    extra?.();
  };

  stop();
  requestAnimationFrame(() => {
    stop();
    requestAnimationFrame(stop);
  });
  window.setTimeout(stop, 80);
  window.setTimeout(stop, 250);
  window.setTimeout(() => unfreezeScrollElements(scrollElements), 350);
}

export function watchNextTapAfterGesture(label: string, durationMs = 2500) {
  if (typeof document === "undefined" || typeof window === "undefined") return;

  const startedAt = performance.now();
  const maxTapDistance = 12;
  const fallbackClickDelayMs = 180;
  const events = [
    "pointerdown",
    "pointerup",
    "touchstart",
    "touchend",
    "mousedown",
    "mouseup",
    "click",
  ];

  let timeoutId: number | null = null;
  let fallbackClickId: number | null = null;
  let tapCandidate: {
    target: HTMLElement;
    startPoint: { x: number; y: number };
    endPoint: { x: number; y: number } | null;
  } | null = null;

  const log = (phase: string, payload: Record<string, unknown> = {}) => {
    const message = `[gesture-debug:${label}] ${phase} ${JSON.stringify({
      elapsedMs: Math.round(performance.now() - startedAt),
      ...payload,
    })}`;

    console.warn(message);
    void import("@/lib/audio/native-engine")
      .then(({ nativeDebugLog }) => nativeDebugLog(message))
      .catch(() => {
        // Native logging is only available in the mobile app.
      });
  };

  const cleanup = () => {
    for (const eventName of events) {
      document.removeEventListener(eventName, handleEvent, true);
    }
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (fallbackClickId !== null) {
      window.clearTimeout(fallbackClickId);
      fallbackClickId = null;
    }
  };

  const handleEvent = (event: Event) => {
    const point = getEventPoint(event);
    const hitElement = point
      ? document.elementFromPoint(point.x, point.y)
      : null;

    log(event.type, {
      point,
      target: describeGestureElement(event.target),
      currentTarget: describeGestureElement(event.currentTarget),
      elementFromPoint: describeGestureElement(hitElement),
      defaultPrevented: event.defaultPrevented,
      activeElement: describeGestureElement(document.activeElement),
      overlays: getGestureOverlaySnapshot(),
    });

    if (event.type === "pointerdown" || event.type === "touchstart") {
      const target = getGestureClickTarget(event.target, hitElement);
      if (target && point) {
        tapCandidate = { target, startPoint: point, endPoint: null };
      }
    }

    if (event.type === "pointerup" || event.type === "touchend") {
      maybeScheduleFallbackClick(point, hitElement);
    }

    if (event.type === "click") {
      window.setTimeout(cleanup, 0);
    }
  };

  const maybeScheduleFallbackClick = (
    point: { x: number; y: number } | null,
    hitElement: Element | null,
  ) => {
    if (!tapCandidate || !point || fallbackClickId !== null) return;

    const dx = point.x - tapCandidate.startPoint.x;
    const dy = point.y - tapCandidate.startPoint.y;
    if (Math.hypot(dx, dy) > maxTapDistance) return;

    tapCandidate.endPoint = point;
    const candidate = tapCandidate;

    fallbackClickId = window.setTimeout(() => {
      fallbackClickId = null;
      if (!document.contains(candidate.target)) {
        log("synth-click-skipped", { reason: "target-detached" });
        cleanup();
        return;
      }

      const currentHit = document.elementFromPoint(point.x, point.y);
      if (
        !isGestureClickTargetStillHit(
          candidate.target,
          currentHit ?? hitElement,
        )
      ) {
        log("synth-click-skipped", {
          reason: "target-changed",
          target: describeGestureElement(candidate.target),
          elementFromPoint: describeGestureElement(currentHit),
        });
        cleanup();
        return;
      }

      if (isGestureClickTargetDisabled(candidate.target)) {
        log("synth-click-skipped", {
          reason: "target-disabled",
          target: describeGestureElement(candidate.target),
        });
        cleanup();
        return;
      }

      log("synth-click", {
        point,
        target: describeGestureElement(candidate.target),
      });

      candidate.target.click();
    }, fallbackClickDelayMs);
  };

  for (const eventName of events) {
    document.addEventListener(eventName, handleEvent, true);
  }

  log("armed", { overlays: getGestureOverlaySnapshot() });
  timeoutId = window.setTimeout(() => {
    log("timeout-no-click", { overlays: getGestureOverlaySnapshot() });
    cleanup();
  }, durationMs);
}

function getEventPoint(event: Event): { x: number; y: number } | null {
  if (event instanceof MouseEvent) {
    return { x: event.clientX, y: event.clientY };
  }

  if (typeof TouchEvent !== "undefined" && event instanceof TouchEvent) {
    const touch = event.changedTouches[0] ?? event.touches[0];
    if (touch) return { x: touch.clientX, y: touch.clientY };
  }

  return null;
}

function describeGestureElement(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;

  const tagName = target.tagName.toLowerCase();
  const id = target.id ? `#${target.id}` : "";
  const testId = target.getAttribute("data-testid");
  const role = target.getAttribute("role");
  const ariaLabel = target.getAttribute("aria-label");
  const classNames = Array.from(target.classList).slice(0, 4).join(".");
  const classSuffix = classNames ? `.${classNames}` : "";

  return [
    `${tagName}${id}${classSuffix}`,
    testId ? `testid=${testId}` : null,
    role ? `role=${role}` : null,
    ariaLabel ? `label=${ariaLabel}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function getGestureClickTarget(
  eventTarget: EventTarget | null,
  hitElement: Element | null,
): HTMLElement | null {
  const candidates = [eventTarget, hitElement];
  for (const candidate of candidates) {
    if (!(candidate instanceof Element)) continue;

    const actionable = candidate.closest(
      'button, a, input, select, textarea, [role="button"], [role="menuitem"], [tabindex]',
    );
    if (actionable instanceof HTMLElement) return actionable;
    if (candidate instanceof HTMLElement) return candidate;
  }

  return null;
}

function isGestureClickTargetStillHit(
  target: HTMLElement,
  hitElement: Element | null,
) {
  if (!hitElement) return false;
  return target === hitElement || target.contains(hitElement);
}

function isGestureClickTargetDisabled(target: HTMLElement) {
  return Boolean(
    target.closest(
      'button:disabled, input:disabled, select:disabled, textarea:disabled, [aria-disabled="true"], [data-disabled="true"]',
    ),
  );
}

function getGestureOverlaySnapshot() {
  const selectors = [
    '[data-fullscreen-player="true"]',
    '[data-testid="fullscreen-backdrop"]',
    '[role="dialog"]',
    '[data-gesture-closing="true"]',
  ];
  const elements = new Set<HTMLElement>();

  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach((element) => {
      if (element instanceof HTMLElement) elements.add(element);
    });
  }

  return Array.from(elements).map((element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return {
      element: describeGestureElement(element),
      pointerEvents: style.pointerEvents,
      visibility: style.visibility,
      display: style.display,
      opacity: style.opacity,
      transform: style.transform,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  });
}

function getKnownScrollElements(): HTMLElement[] {
  if (typeof document === "undefined") return [];

  return [
    document.getElementById("main-scroll-container"),
    ...Array.from(document.querySelectorAll("[data-scroll-container]")),
  ].filter((el): el is HTMLElement => el instanceof HTMLElement);
}

function freezeScrollElements(elements: HTMLElement[]) {
  for (const element of elements) {
    if (!frozenScrollElements.has(element)) {
      frozenScrollElements.set(element, {
        overflowY: element.style.overflowY,
        touchAction: element.style.touchAction,
      });
    }
    element.style.overflowY = "hidden";
    element.style.touchAction = "none";
  }
}

function unfreezeScrollElements(elements: HTMLElement[]) {
  for (const element of elements) {
    const previous = frozenScrollElements.get(element);
    if (!previous) continue;
    element.style.overflowY = previous.overflowY;
    element.style.touchAction = previous.touchAction;
    frozenScrollElements.delete(element);
  }
}
