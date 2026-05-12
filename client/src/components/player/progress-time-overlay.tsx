"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/format";
import type { ProgressTimeLabelVisibility } from "@/lib/store/ui";

interface ProgressTimeOverlayProps {
  currentTime: number;
  currentPercent: number;
  duration: number;
  scrubPercent: number | null;
  scrubTime: number | null;
  hasTrack: boolean;
  interactionVisible: boolean;
  currentLabelVisibility: ProgressTimeLabelVisibility;
}

const COLLISION_PADDING_PX = 8;

interface LabelBounds {
  left: number;
  right: number;
}

interface LabelMeasurements {
  containerWidth: number;
  currentWidth: number;
  scrubWidth: number;
}

function clampPercent(percent: number): number {
  return Math.max(0, Math.min(100, percent));
}

function getFallbackLabelStyle(percent: number): CSSProperties {
  const clampedPercent = clampPercent(percent);
  if (clampedPercent < 4) {
    return { left: `${clampedPercent}%`, transform: "translateX(0)" };
  }
  if (clampedPercent > 96) {
    return { left: `${clampedPercent}%`, transform: "translateX(-100%)" };
  }
  return { left: `${clampedPercent}%`, transform: "translateX(-50%)" };
}

function getLabelBounds(
  percent: number,
  labelWidth: number,
  containerWidth: number,
): LabelBounds {
  const anchorX = (clampPercent(percent) / 100) * containerWidth;
  const maxLeft = Math.max(0, containerWidth - labelWidth);
  const left = Math.max(0, Math.min(maxLeft, anchorX - labelWidth / 2));

  return {
    left,
    right: left + labelWidth,
  };
}

function getMeasuredLabelStyle(
  percent: number,
  labelWidth: number,
  containerWidth: number,
): CSSProperties {
  if (containerWidth <= 0 || labelWidth <= 0) {
    return getFallbackLabelStyle(percent);
  }

  return {
    left: `${getLabelBounds(percent, labelWidth, containerWidth).left}px`,
  };
}

function labelsCollide(
  first: LabelBounds,
  second: LabelBounds,
  padding: number,
): boolean {
  return (
    first.left < second.right + padding && second.left < first.right + padding
  );
}

function estimateLabelWidth(text: string): number {
  return text.length * 7 + 14;
}

export function ProgressTimeOverlay({
  currentTime,
  currentPercent,
  duration,
  scrubPercent,
  scrubTime,
  hasTrack,
  interactionVisible,
  currentLabelVisibility,
}: ProgressTimeOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentLabelRef = useRef<HTMLSpanElement>(null);
  const scrubLabelRef = useRef<HTMLSpanElement>(null);
  const [measurements, setMeasurements] = useState<LabelMeasurements>({
    containerWidth: 0,
    currentWidth: 0,
    scrubWidth: 0,
  });

  const normalizedCurrentPercent = clampPercent(currentPercent);
  const normalizedScrubPercent =
    scrubPercent === null ? null : clampPercent(scrubPercent);
  const currentLabelEnabled = hasTrack && currentLabelVisibility !== "never";
  const currentLabelVisible =
    currentLabelEnabled &&
    (currentLabelVisibility === "always" || interactionVisible);
  const scrubVisible =
    hasTrack &&
    interactionVisible &&
    normalizedScrubPercent !== null &&
    scrubTime !== null;
  const overlayVisible = currentLabelVisible || scrubVisible;
  const currentLabel = `${formatDuration(currentTime)} / ${formatDuration(duration)}`;
  const scrubLabel = scrubTime === null ? "" : formatDuration(scrubTime);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const currentLabelElement = currentLabelRef.current;
    const scrubLabelElement = scrubLabelRef.current;
    if (!container) return;

    const updateMeasurements = () => {
      setMeasurements({
        containerWidth: container.getBoundingClientRect().width,
        currentWidth: currentLabelElement?.getBoundingClientRect().width ?? 0,
        scrubWidth: scrubLabelElement?.getBoundingClientRect().width ?? 0,
      });
    };

    updateMeasurements();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateMeasurements);
      return () => window.removeEventListener("resize", updateMeasurements);
    }

    const observer = new ResizeObserver(updateMeasurements);
    observer.observe(container);
    if (currentLabelElement) observer.observe(currentLabelElement);
    if (scrubLabelElement) observer.observe(scrubLabelElement);

    return () => observer.disconnect();
  }, [currentLabelEnabled, scrubVisible, currentLabel, scrubLabel]);

  const currentWidth = currentLabelEnabled
    ? measurements.currentWidth || estimateLabelWidth(currentLabel)
    : 0;
  const scrubWidth =
    measurements.scrubWidth ||
    (scrubVisible ? estimateLabelWidth(scrubLabel) : 0);

  const currentLabelBounds = currentLabelEnabled
    ? getLabelBounds(
        normalizedCurrentPercent,
        currentWidth,
        measurements.containerWidth,
      )
    : null;
  const scrubLabelBounds =
    scrubVisible && normalizedScrubPercent !== null
      ? getLabelBounds(
          normalizedScrubPercent,
          scrubWidth,
          measurements.containerWidth,
        )
      : null;
  const hideCurrent =
    currentLabelVisible &&
    scrubVisible &&
    currentLabelBounds !== null &&
    scrubLabelBounds !== null &&
    measurements.containerWidth > 0 &&
    currentWidth > 0 &&
    scrubWidth > 0 &&
    labelsCollide(currentLabelBounds, scrubLabelBounds, COLLISION_PADDING_PX);
  const labelClassName =
    "absolute top-0 rounded border border-border/70 bg-background/95 px-1.5 py-0.5 shadow-sm backdrop-blur transition-opacity duration-100";

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      data-testid="progress-time-overlay"
      className={cn(
        "pointer-events-none absolute bottom-full left-0 right-0 z-20 mb-2 h-5 text-[11px] font-medium tabular-nums text-muted-foreground",
        "translate-y-1 opacity-0 transition-[opacity,transform] duration-150 ease-out",
        overlayVisible && "translate-y-0 opacity-100",
      )}
    >
      {currentLabelEnabled && (
        <span
          ref={currentLabelRef}
          data-testid="progress-current-duration"
          className={cn(
            labelClassName,
            hideCurrent && "invisible opacity-0 duration-0",
          )}
          style={getMeasuredLabelStyle(
            normalizedCurrentPercent,
            currentWidth,
            measurements.containerWidth,
          )}
        >
          {currentLabel}
        </span>
      )}
      {scrubVisible && (
        <span
          ref={scrubLabelRef}
          data-testid="progress-scrub-time"
          className={labelClassName}
          style={getMeasuredLabelStyle(
            normalizedScrubPercent,
            scrubWidth,
            measurements.containerWidth,
          )}
        >
          {scrubLabel}
        </span>
      )}
    </div>
  );
}
