"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Distance from the scroll container's edge where auto-scroll kicks in. */
const EDGE_PX = 56;
/** Auto-scroll speed at the very edge, in px per frame. */
const MAX_SCROLL_PX_PER_FRAME = 18;

export interface ReorderRowBounds {
  index: number;
  top: number;
  bottom: number;
}

/**
 * Index the dragged row lands on: the rendered row under the floating copy's
 * center, or the nearest end row when the center is above or below them all.
 * Returns `fallback` when no rows are rendered.
 */
export function reorderTargetIndex(
  centerY: number,
  rows: ReorderRowBounds[],
  fallback: number,
): number {
  if (rows.length === 0) return fallback;
  const sorted = [...rows].sort((a, b) => a.top - b.top);
  for (const row of sorted) {
    if (centerY < row.bottom) return row.index;
  }
  return sorted[sorted.length - 1].index;
}

/**
 * Auto-scroll step for a pointer near the top or bottom edge of the scroll
 * container: negative scrolls up, 0 outside the edge zones.
 */
export function edgeScrollSpeed(
  pointerY: number,
  top: number,
  bottom: number,
  edgePx = EDGE_PX,
  maxSpeed = MAX_SCROLL_PX_PER_FRAME,
): number {
  if (pointerY < top + edgePx) {
    const depth = Math.min(1, (top + edgePx - pointerY) / edgePx);
    return -Math.ceil(depth * maxSpeed);
  }
  if (pointerY > bottom - edgePx) {
    const depth = Math.min(1, (pointerY - (bottom - edgePx)) / edgePx);
    return Math.ceil(depth * maxSpeed);
  }
  return 0;
}

interface DragSession {
  from: number;
  pointerId: number;
  pointerY: number;
  /** Pointer offset from the dragged row's top edge. */
  grabOffset: number;
  rowHeight: number;
  target: number;
}

export interface ListReorderOptions {
  /** Number of rows (virtualized lists: the full count), for keyboard moves. */
  count: number;
  /** Scroll container of the list, used for edge auto-scroll. */
  getScrollElement: () => HTMLElement | null;
  /** Called on drop with the dragged index and its final index. */
  onReorder: (from: number, to: number) => void;
  /** Content of the floating row that follows the pointer. */
  renderGhost: (index: number) => ReactNode;
}

export interface ListReorder {
  /** Index of the row being dragged; changes only at drag start and end. */
  draggingIndex: number | null;
  /** Props for a row's drag handle (pointer drag, Up/Down keys). */
  handleProps: (index: number) => {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
    style: React.CSSProperties;
    "data-reorder-handle": true;
  };
  /** Floating row and drop line; render once anywhere in the list's tree. */
  overlay: ReactNode;
}

/**
 * Drag-to-reorder for (virtualized) lists.
 *
 * Rows mark their outer element with `data-reorder-row` and
 * `data-reorder-index={index}` inside the scroll container, and spread
 * `handleProps(index)` onto a handle. The drop target is hit-tested against
 * the rendered rows, so row heights may vary. While dragging, the floating row and
 * the drop line are positioned with direct style writes from pointer and
 * animation-frame callbacks, so the list re-renders only when a drag starts
 * and ends — never while the pointer moves or the list auto-scrolls.
 */
export function useListReorder({
  count,
  getScrollElement,
  onReorder,
  renderGhost,
}: ListReorderOptions): ListReorder {
  const [dragging, setDragging] = useState<{
    index: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const sessionRef = useRef<DragSession | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const lineRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  // Latest options for the window listeners, which outlive a render.
  const optionsRef = useRef({ getScrollElement, onReorder });
  useEffect(() => {
    optionsRef.current = { getScrollElement, onReorder };
  });

  const paint = () => {
    const session = sessionRef.current;
    if (!session) return;
    const scrollElement = optionsRef.current.getScrollElement();
    const ghostTop = session.pointerY - session.grabOffset;
    const rows: ReorderRowBounds[] = [];
    scrollElement
      ?.querySelectorAll<HTMLElement>("[data-reorder-index]")
      .forEach((element) => {
        const rect = element.getBoundingClientRect();
        rows.push({
          index: Number(element.dataset.reorderIndex),
          top: rect.top,
          bottom: rect.bottom,
        });
      });
    session.target = reorderTargetIndex(
      ghostTop + session.rowHeight / 2,
      rows,
      session.target,
    );

    const ghost = ghostRef.current;
    if (ghost) ghost.style.transform = `translateY(${ghostTop}px)`;
    const line = lineRef.current;
    if (line) {
      const targetRow = rows.find((row) => row.index === session.target);
      const bounds = scrollElement?.getBoundingClientRect();
      const y = targetRow
        ? session.target < session.from
          ? targetRow.top
          : targetRow.bottom
        : null;
      const visible =
        y !== null &&
        session.target !== session.from &&
        (!bounds || (y >= bounds.top - 1 && y <= bounds.bottom + 1));
      if (y !== null) line.style.transform = `translateY(${y - 1}px)`;
      line.style.opacity = visible ? "1" : "0";
    }
  };

  const stopFrames = () => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  };

  // Each frame: auto-scroll near the edges, then reposition ghost and line.
  const tick = () => {
    frameRef.current = null;
    const session = sessionRef.current;
    if (!session) return;
    const scrollElement = optionsRef.current.getScrollElement();
    if (scrollElement) {
      const bounds = scrollElement.getBoundingClientRect();
      const speed = edgeScrollSpeed(
        session.pointerY,
        bounds.top,
        bounds.bottom,
      );
      if (speed !== 0) scrollElement.scrollTop += speed;
    }
    paint();
    frameRef.current = requestAnimationFrame(tick);
  };

  const finish = (commit: boolean) => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    stopFrames();
    document.body.style.removeProperty("user-select");
    document.body.style.removeProperty("cursor");
    setDragging(null);
    if (!commit) return;
    if (session.target !== session.from) {
      optionsRef.current.onReorder(session.from, session.target);
    }
  };

  // Window listeners keep the drag alive when the dragged row scrolls out of
  // the virtualized range and unmounts.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      event.preventDefault();
      session.pointerY = event.clientY;
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== sessionRef.current?.pointerId) return;
      finish(event.type === "pointerup");
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey, true);
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey, true);
      stopFrames();
    };
    // Listeners only depend on whether a drag is active; everything else is
    // read from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging !== null]);

  const handleProps = (index: number) => ({
    "data-reorder-handle": true as const,
    style: { touchAction: "none", cursor: "grab" },
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || sessionRef.current) return;
      const row =
        event.currentTarget.closest<HTMLElement>("[data-reorder-row]") ??
        event.currentTarget;
      const rowRect = row.getBoundingClientRect();
      event.preventDefault();
      event.stopPropagation();
      sessionRef.current = {
        from: index,
        pointerId: event.pointerId,
        pointerY: event.clientY,
        grabOffset: event.clientY - rowRect.top,
        rowHeight: rowRect.height,
        target: index,
      };
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
      setDragging({
        index,
        left: rowRect.left,
        width: rowRect.width,
        height: rowRect.height,
      });
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      const step =
        event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      if (step === 0) return;
      event.preventDefault();
      const to = index + step;
      if (to >= 0 && to < count) onReorder(index, to);
    },
  });

  const overlay =
    dragging && typeof document !== "undefined"
      ? createPortal(
          <>
            <div
              ref={(element) => {
                lineRef.current = element;
                paint();
              }}
              data-testid="reorder-drop-line"
              className="pointer-events-none fixed top-0 z-[100] h-0.5 rounded-full bg-primary"
              style={{ left: dragging.left, width: dragging.width }}
            />
            <div
              ref={(element) => {
                ghostRef.current = element;
                paint();
              }}
              className="pointer-events-none fixed top-0 z-[100] rounded-lg bg-card shadow-xl ring-1 ring-border"
              style={{
                left: dragging.left,
                width: dragging.width,
                height: dragging.height,
              }}
            >
              {renderGhost(dragging.index)}
            </div>
          </>,
          document.body,
        )
      : null;

  return {
    draggingIndex: dragging?.index ?? null,
    handleProps,
    overlay,
  };
}
