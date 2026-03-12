"use client";

import type { ReactNode } from "react";
import { useState, createContext, useContext } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { CoverImage } from "@/components/shared/cover-image";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";

// ===================================
// Drawer close context
// ===================================

const DrawerCloseContext = createContext<(() => void) | null>(null);

function useDrawerClose() {
  return useContext(DrawerCloseContext);
}

// ===================================
// DrawerMenu - main wrapper
// ===================================

interface DrawerMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  subtitle?: string;
  thumbnail?: string;
  children: ReactNode;
}

export function DrawerMenu({
  open,
  onOpenChange,
  title,
  subtitle,
  thumbnail,
  children,
}: DrawerMenuProps) {
  const close = () => onOpenChange(false);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        {title && (
          <DrawerHeader className="flex-row items-center gap-3">
            {thumbnail && (
              <CoverImage
                src={thumbnail}
                alt={title}
                size="sm"
                className="shrink-0 rounded"
              />
            )}
            <div className="min-w-0 flex-1">
              <DrawerTitle className="truncate text-sm">{title}</DrawerTitle>
              {subtitle && (
                <DrawerDescription className="truncate text-xs">
                  {subtitle}
                </DrawerDescription>
              )}
            </div>
          </DrawerHeader>
        )}
        <div className="overflow-y-auto overscroll-contain px-2 pb-safe pb-4">
          <DrawerCloseContext.Provider value={close}>
            {children}
          </DrawerCloseContext.Provider>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// ===================================
// DrawerMenuItem
// ===================================

interface DrawerMenuItemProps {
  onClick?: () => void;
  asChild?: boolean;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}

export function DrawerMenuItem({
  onClick,
  asChild,
  children,
  className,
  disabled,
}: DrawerMenuItemProps) {
  const close = useDrawerClose();

  const itemClassName = cn(
    "flex w-full cursor-default items-center gap-3 rounded-lg px-3 py-3 text-sm outline-none select-none active:bg-accent [&_svg:not([class*='text-'])]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
    disabled && "opacity-50 pointer-events-none",
    className,
  );

  // When asChild is true, children is a Link element — wrap it in a div that closes the drawer
  if (asChild) {
    return (
      <div
        onClick={() => close?.()}
        className={cn(
          itemClassName,
          "[&_a]:flex [&_a]:w-full [&_a]:items-center [&_a]:gap-3",
        )}
      >
        {children}
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        onClick?.();
        close?.();
      }}
      className={itemClassName}
    >
      {children}
    </button>
  );
}

// ===================================
// DrawerMenuSeparator
// ===================================

export function DrawerMenuSeparator() {
  return <div className="bg-border -mx-1 my-1 h-px" />;
}

// ===================================
// Collapsible sub-menu components
// ===================================

interface DrawerMenuCollapsibleProps {
  children: ReactNode;
}

export function DrawerMenuCollapsible({
  children,
}: DrawerMenuCollapsibleProps) {
  const [open, setOpen] = useState(false);
  return (
    <CollapsibleContext.Provider value={{ open, setOpen }}>
      <div>{children}</div>
    </CollapsibleContext.Provider>
  );
}

const CollapsibleContext = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
}>({ open: false, setOpen: () => {} });

interface DrawerMenuCollapsibleTriggerProps {
  children: ReactNode;
}

export function DrawerMenuCollapsibleTrigger({
  children,
}: DrawerMenuCollapsibleTriggerProps) {
  const { open, setOpen } = useContext(CollapsibleContext);

  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className="flex w-full cursor-default items-center gap-3 rounded-lg px-3 py-3 text-sm outline-none select-none active:bg-accent [&_svg:not([class*='text-'])]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5"
    >
      {children}
      <ChevronDown
        className={cn(
          "!text-muted-foreground ml-auto size-4 transition-transform duration-200",
          open && "rotate-180",
        )}
      />
    </button>
  );
}

interface DrawerMenuCollapsibleContentProps {
  children: ReactNode;
}

export function DrawerMenuCollapsibleContent({
  children,
}: DrawerMenuCollapsibleContentProps) {
  const { open } = useContext(CollapsibleContext);

  if (!open) return null;

  return <div className="ml-4 border-l border-border pl-2">{children}</div>;
}
