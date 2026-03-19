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

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);

  // Sonner calls setPointerCapture on pointerDown for swipe-to-dismiss but never
  // calls releasePointerCapture. When a toast is removed from DOM during the swipe
  // animation, the implicit capture release doesn't always clean up properly on
  // mobile browsers/WebViews, leaving a stuck state that requires an extra tap.
  // Explicitly releasing pointer capture on pointerUp fixes this.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handlePointerUp = (e: PointerEvent) => {
      if (e.target instanceof HTMLElement) {
        try {
          e.target.releasePointerCapture(e.pointerId);
        } catch {
          // Ignore if no capture was held
        }
      }
    };

    container.addEventListener("pointerup", handlePointerUp, true);
    return () =>
      container.removeEventListener("pointerup", handlePointerUp, true);
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
