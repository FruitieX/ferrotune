import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Read the safe-area-inset-top CSS variable (set by Tauri on Android). Returns 0 when not available. */
export function getSafeAreaTop(): number {
  if (typeof document === "undefined") return 0;
  return parseInt(
    getComputedStyle(document.documentElement)
      .getPropertyValue("--safe-area-top")
      .trim() || "0",
    10,
  );
}

/**
 * Merge a safe-area top collision padding into an existing collisionPadding value
 * used by Radix UI popover/menu components so menus don't overlap the Android status bar.
 */
export function withSafeAreaCollisionPadding(
  collisionPadding:
    | number
    | Partial<Record<"top" | "bottom" | "left" | "right", number>>
    | undefined,
):
  | number
  | Partial<Record<"top" | "bottom" | "left" | "right", number>>
  | undefined {
  const safeTop = getSafeAreaTop();
  if (safeTop <= 0) return collisionPadding;
  return {
    top: safeTop,
    ...(typeof collisionPadding === "number"
      ? {
          bottom: collisionPadding,
          left: collisionPadding,
          right: collisionPadding,
        }
      : collisionPadding),
  };
}
