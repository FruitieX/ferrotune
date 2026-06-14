"use client";

import { useEffect } from "react";
import { stopMainScrollInertia } from "@/lib/utils/gesture";

/**
 * Stop inertial scrolling on the first pointerdown anywhere in the
 * document. On Android WebView a container can keep "coasting" after the
 * user lifts their finger; the next tap is consumed to stop the coast and
 * the click on the tapped element is lost. Re-applying the current scroll
 * offset on pointerdown cancels the coast before the click is dispatched,
 * so taps on buttons and controls remain responsive.
 *
 * This is installed at the top level of the app and is a passive no-op
 * when no element is currently inertial scrolling.
 */
export function useStopScrollInertiaOnTap() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePointerDown = () => {
      stopMainScrollInertia();
    };

    window.addEventListener("pointerdown", handlePointerDown, {
      passive: true,
    });
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);
}
