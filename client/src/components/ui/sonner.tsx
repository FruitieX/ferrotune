"use client";

import { useEffect, useRef } from "react";
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { watchNextTapAfterGesture } from "@/lib/utils/gesture";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const activeSwipeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    maxDistance: number;
  } | null>(null);

  // Sonner calls setPointerCapture on pointerDown for swipe-to-dismiss but never
  // calls releasePointerCapture. When a toast is removed from DOM during the swipe
  // animation, the implicit capture release doesn't always clean up properly on
  // mobile browsers/WebViews, leaving a stuck state that requires an extra tap.
  // Explicitly releasing pointer capture on pointerUp fixes this.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const getToastElement = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return null;
      return target.closest("[data-sonner-toast]");
    };

    const releaseToastPointerCapture = (e: PointerEvent) => {
      const toast = getToastElement(e.target);
      const targets = [e.target, toast];

      for (const target of targets) {
        if (!(target instanceof HTMLElement)) continue;
        try {
          target.releasePointerCapture(e.pointerId);
        } catch {
          // Ignore if no capture was held.
        }
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (!getToastElement(e.target)) return;

      activeSwipeRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        maxDistance: 0,
      };
    };

    const handlePointerMove = (e: PointerEvent) => {
      const activeSwipe = activeSwipeRef.current;
      if (!activeSwipe || activeSwipe.pointerId !== e.pointerId) return;

      activeSwipe.maxDistance = Math.max(
        activeSwipe.maxDistance,
        Math.hypot(
          e.clientX - activeSwipe.startX,
          e.clientY - activeSwipe.startY,
        ),
      );
    };

    const finishPointerGesture = (e: PointerEvent) => {
      releaseToastPointerCapture(e);

      const activeSwipe = activeSwipeRef.current;
      activeSwipeRef.current = null;
      if (!activeSwipe || activeSwipe.pointerId !== e.pointerId) return;

      if (activeSwipe.maxDistance >= 24) {
        watchNextTapAfterGesture("toast-swipe-dismiss");
      }
    };

    container.addEventListener("pointerdown", handlePointerDown, true);
    container.addEventListener("pointermove", handlePointerMove, true);
    container.addEventListener("pointerup", finishPointerGesture, true);
    container.addEventListener("pointercancel", finishPointerGesture, true);
    return () => {
      container.removeEventListener("pointerdown", handlePointerDown, true);
      container.removeEventListener("pointermove", handlePointerMove, true);
      container.removeEventListener("pointerup", finishPointerGesture, true);
      container.removeEventListener(
        "pointercancel",
        finishPointerGesture,
        true,
      );
    };
  }, []);

  return (
    <div ref={containerRef}>
      <Sonner
        theme={theme as ToasterProps["theme"]}
        className="toaster group"
        icons={{
          success: <CircleCheckIcon className="size-4" />,
          info: <InfoIcon className="size-4" />,
          warning: <TriangleAlertIcon className="size-4" />,
          error: <OctagonXIcon className="size-4" />,
          loading: <Loader2Icon className="size-4 animate-spin" />,
        }}
        toastOptions={{
          classNames: {
            actionButton:
              "!bg-primary !text-primary-foreground !font-medium !text-xs !px-3 !py-1.5 !rounded-md hover:!bg-primary/90 !transition-colors",
            cancelButton:
              "!bg-muted !text-muted-foreground !font-medium !text-xs !px-3 !py-1.5 !rounded-md hover:!bg-muted/80 !transition-colors",
          },
          style: {
            pointerEvents: "auto",
          },
        }}
        style={
          {
            "--normal-bg": "var(--popover)",
            "--normal-text": "var(--popover-foreground)",
            "--normal-border": "var(--border)",
            "--border-radius": "var(--radius)",
            pointerEvents: "none",
          } as React.CSSProperties
        }
        {...props}
      />
    </div>
  );
};

export { Toaster };
