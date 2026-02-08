"use client";

import { useAtomValue } from "jotai";
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  clippingDetectionEnabledAtom,
  clippingStateAtom,
  effectiveVolumeAtom,
} from "@/lib/store/player";

const HIDE_AFTER_MS = 2_000;

// External store for visibility — avoids impure Date.now() calls during render
let visibleSnapshot = false;
let hideTimeout: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function subscribeVisibility(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getVisibleSnapshot() {
  return visibleSnapshot;
}

function setVisibleExternal(value: boolean) {
  if (visibleSnapshot !== value) {
    visibleSnapshot = value;
    for (const listener of listeners) listener();
  }
}

/**
 * Hook that provides clipping detection state for the volume icon.
 *
 * When clipping is detected (at 100% volume), `isClipping` becomes true
 * for 2 seconds. The caller should replace the volume icon with AlertTriangle
 * during this period.
 *
 * Returns peak information for both 100% and current volume for tooltip display.
 */
export function useClippingIndicator() {
  const clippingState = useAtomValue(clippingStateAtom);
  const clippingEnabled = useAtomValue(clippingDetectionEnabledAtom);
  const effectiveVolume = useAtomValue(effectiveVolumeAtom);

  const visible = useSyncExternalStore(
    subscribeVisibility,
    getVisibleSnapshot,
    () => false,
  );
  const lastClipTimeRef = useRef(0);

  useEffect(() => {
    const lastClipTime = clippingState?.lastClipTime ?? 0;
    if (!lastClipTime || lastClipTime === lastClipTimeRef.current) return;
    lastClipTimeRef.current = lastClipTime;

    setVisibleExternal(true);

    if (hideTimeout) clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      setVisibleExternal(false);
    }, HIDE_AFTER_MS);
  }, [clippingState]);

  const peakOverDbAt100 = clippingState?.peakOverDbAt100 ?? 0;
  const peakDbAtCurrent =
    effectiveVolume > 0
      ? peakOverDbAt100 + 20 * Math.log10(effectiveVolume)
      : null;
  const volumePercent = Math.round(effectiveVolume * 100);

  return {
    /** Whether the clipping icon should be shown (replaces volume icon) */
    isClipping: clippingEnabled && visible && peakOverDbAt100 > 0,
    /** Peak dB over 0 dBFS at 100% volume */
    peakOverDbAt100,
    /** Peak dB over 0 dBFS at current volume (null if muted, negative = headroom) */
    peakDbAtCurrent,
    /** Current effective volume as percent */
    volumePercent,
  };
}

/**
 * Builds tooltip content for the clipping indicator.
 */
export function formatClippingTooltip(
  peakOverDbAt100: number,
  peakDbAtCurrent: number | null,
  volumePercent: number,
): string {
  const lines: string[] = [];
  lines.push(
    `Clipping at 100% vol: +${peakOverDbAt100.toFixed(1)} dB over 0 dBFS`,
  );

  if (volumePercent === 0) {
    lines.push("Currently muted");
  } else if (volumePercent !== 100 && peakDbAtCurrent !== null) {
    if (peakDbAtCurrent > 0) {
      lines.push(
        `At current volume (${volumePercent}%): +${peakDbAtCurrent.toFixed(1)} dB over 0 dBFS`,
      );
    } else {
      lines.push(
        `At current volume (${volumePercent}%): ${Math.abs(peakDbAtCurrent).toFixed(1)} dB headroom`,
      );
    }
  }

  lines.push("Reduce ReplayGain offset to fix");
  return lines.join("\n");
}
