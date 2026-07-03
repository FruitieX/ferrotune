"use client";

import type { ComponentProps, PointerEvent as ReactPointerEvent } from "react";
import { useRef } from "react";
import { Drawer as DrawerPrimitive } from "vaul";

import { cn } from "@/lib/utils";
import { watchNextTapAfterGesture } from "@/lib/utils/gesture";

function Drawer({ ...props }: ComponentProps<typeof DrawerPrimitive.Root>) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />;
}

function DrawerTrigger({
  ...props
}: ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerPortal({
  ...props
}: ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerClose({
  ...props
}: ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerOverlay({
  className,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      className={cn("fixed inset-0 z-[70] bg-black/50", className)}
      {...props}
    />
  );
}

function DrawerContent({
  className,
  children,
  onPointerDownCapture,
  onPointerMoveCapture,
  onPointerUpCapture,
  onPointerCancelCapture,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Content>) {
  const activeSwipeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    maxDistance: number;
    maxDownwardDistance: number;
  } | null>(null);

  const releaseDrawerPointerCapture = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const targets = [event.target, event.currentTarget];

    for (const target of targets) {
      if (!(target instanceof HTMLElement)) continue;
      try {
        target.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore if no capture was held.
      }
    }
  };

  const handlePointerDownCapture = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    onPointerDownCapture?.(event);
    if (event.defaultPrevented || event.button !== 0) return;

    activeSwipeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      maxDistance: 0,
      maxDownwardDistance: 0,
    };
  };

  const handlePointerMoveCapture = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    onPointerMoveCapture?.(event);
    const activeSwipe = activeSwipeRef.current;
    if (!activeSwipe || activeSwipe.pointerId !== event.pointerId) return;

    const dx = event.clientX - activeSwipe.startX;
    const dy = event.clientY - activeSwipe.startY;
    activeSwipe.maxDistance = Math.max(
      activeSwipe.maxDistance,
      Math.hypot(dx, dy),
    );
    activeSwipe.maxDownwardDistance = Math.max(
      activeSwipe.maxDownwardDistance,
      dy,
    );
  };

  const finishPointerGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.type === "pointerup") {
      onPointerUpCapture?.(event);
    } else {
      onPointerCancelCapture?.(event);
    }

    releaseDrawerPointerCapture(event);

    const activeSwipe = activeSwipeRef.current;
    activeSwipeRef.current = null;
    if (!activeSwipe || activeSwipe.pointerId !== event.pointerId) return;

    if (
      activeSwipe.maxDistance >= 24 &&
      activeSwipe.maxDownwardDistance >= 24
    ) {
      watchNextTapAfterGesture("drawer-swipe-dismiss");
    }
  };

  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          "bg-background fixed inset-x-0 bottom-0 z-[70] mt-24 flex max-h-[80dvh] flex-col rounded-t-xl border-t outline-none",
          className,
        )}
        onPointerDownCapture={handlePointerDownCapture}
        onPointerMoveCapture={handlePointerMoveCapture}
        onPointerUpCapture={finishPointerGesture}
        onPointerCancelCapture={finishPointerGesture}
        {...props}
      >
        <div className="bg-muted mx-auto mt-3 mb-2 h-1.5 w-12 shrink-0 rounded-full" />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  );
}

function DrawerHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn("flex flex-col gap-1.5 px-4 pb-2", className)}
      {...props}
    />
  );
}

function DrawerFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

function DrawerTitle({
  className,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("text-foreground font-semibold", className)}
      {...props}
    />
  );
}

function DrawerDescription({
  className,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};
