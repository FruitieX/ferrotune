"use client";

import { useState, type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DrawerMenu,
  DrawerMenuItem,
  DrawerMenuSeparator,
  DrawerMenuCollapsible,
  DrawerMenuCollapsibleTrigger,
  DrawerMenuCollapsibleContent,
} from "@/components/shared/drawer-menu";
export {
  DrawerMenuItem,
  DrawerMenuSeparator,
  DrawerMenuCollapsible,
  DrawerMenuCollapsibleTrigger,
  DrawerMenuCollapsibleContent,
};
import type { MenuComponents } from "@/components/shared/media-menu-items";
import { useHasFinePointer } from "@/lib/hooks/use-media-query";

// ===================================
// Menu component adapters (centralized)
// ===================================

export const contextMenuComponents: MenuComponents = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

export const dropdownMenuComponents: MenuComponents = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

export const drawerMenuComponents: MenuComponents = {
  Item: DrawerMenuItem,
  Separator: DrawerMenuSeparator,
  Sub: DrawerMenuCollapsible,
  SubTrigger: DrawerMenuCollapsibleTrigger,
  SubContent: DrawerMenuCollapsibleContent,
};

// ===================================
// ResponsiveContextMenu
// ===================================

interface ResponsiveContextMenuProps {
  children: ReactNode;
  /** Content to render inside the menu. Receives MenuComponents adapter. */
  renderMenuContent: (components: MenuComponents) => ReactNode;
  /** Optional className for the desktop ContextMenuContent */
  contentClassName?: string;
  /** Collision padding for desktop context menu */
  collisionPadding?:
    | number
    | { top?: number; right?: number; bottom?: number; left?: number };
  /** Drawer header info */
  drawerTitle?: string;
  drawerSubtitle?: string;
  drawerThumbnail?: string;
}

export function ResponsiveContextMenu({
  children,
  renderMenuContent,
  contentClassName = "w-56",
  collisionPadding,
  drawerTitle,
  drawerSubtitle,
  drawerThumbnail,
}: ResponsiveContextMenuProps) {
  const hasFinePointer = useHasFinePointer();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Desktop: standard context menu
  if (hasFinePointer) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent
          className={contentClassName}
          onDoubleClick={(e) => e.stopPropagation()}
          collisionPadding={collisionPadding}
        >
          {renderMenuContent(contextMenuComponents)}
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  // Mobile: intercept context menu open → show drawer
  return (
    <>
      <ContextMenu
        onOpenChange={(open) => {
          if (open) setDrawerOpen(true);
        }}
      >
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        {/* Render empty content so Radix doesn't error, but it won't be visible
            since we immediately close via onOpenChange intercepting */}
        <ContextMenuContent className="hidden" />
      </ContextMenu>
      <DrawerMenu
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title={drawerTitle}
        subtitle={drawerSubtitle}
        thumbnail={drawerThumbnail}
      >
        {renderMenuContent(drawerMenuComponents)}
      </DrawerMenu>
    </>
  );
}

// ===================================
// ResponsiveDropdownMenu
// ===================================

interface ResponsiveDropdownMenuProps {
  trigger: ReactNode;
  /** Content to render inside the menu. Receives MenuComponents adapter. */
  renderMenuContent: (components: MenuComponents) => ReactNode;
  /** Optional className for the desktop DropdownMenuContent */
  contentClassName?: string;
  /** Alignment for desktop dropdown */
  align?: "start" | "center" | "end";
  /** Side for desktop dropdown */
  side?: "top" | "right" | "bottom" | "left";
  /** Callback when open state changes (for desktop behavior like dismissing context menus) */
  onOpenChange?: (open: boolean) => void;
  /** Drawer header info */
  drawerTitle?: string;
  drawerSubtitle?: string;
  drawerThumbnail?: string;
  /** Extra content only shown in the mobile drawer (e.g., sort/view settings) */
  drawerExtraContent?: ReactNode;
}

export function ResponsiveDropdownMenu({
  trigger,
  renderMenuContent,
  contentClassName = "w-56",
  align = "end",
  side,
  onOpenChange,
  drawerTitle,
  drawerSubtitle,
  drawerThumbnail,
  drawerExtraContent,
}: ResponsiveDropdownMenuProps) {
  const hasFinePointer = useHasFinePointer();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Desktop: standard dropdown menu
  if (hasFinePointer) {
    return (
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent
          align={align}
          side={side}
          className={contentClassName}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {renderMenuContent(dropdownMenuComponents)}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Mobile: button opens drawer
  // Use onClickCapture so we intercept the event during capture phase,
  // before any stopPropagation() in the trigger's own onClick handler.
  return (
    <>
      <div
        onClickCapture={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpenChange?.(true);
          setDrawerOpen(true);
        }}
      >
        {trigger}
      </div>
      <DrawerMenu
        open={drawerOpen}
        onOpenChange={(open) => {
          setDrawerOpen(open);
          if (!open) onOpenChange?.(false);
        }}
        title={drawerTitle}
        subtitle={drawerSubtitle}
        thumbnail={drawerThumbnail}
      >
        {renderMenuContent(drawerMenuComponents)}
        {drawerExtraContent}
      </DrawerMenu>
    </>
  );
}
