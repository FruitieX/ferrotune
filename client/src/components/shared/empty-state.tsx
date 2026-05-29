"use client";

import type { LucideIcon } from "lucide-react";
import { Music } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /** Icon to display */
  icon?: LucideIcon;
  /** Title text */
  title?: string;
  /** Description text */
  description?: string;
  /** Optional action button */
  action?: React.ReactNode;
  /** Additional classes */
  className?: string;
}

export function EmptyState({
  icon: Icon = Music,
  title = "No items",
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-24 text-center px-4",
        "animate-in fade-in-0 zoom-in-95 duration-500",
        className,
      )}
    >
      <div className="w-24 h-24 rounded-full bg-muted/50 border border-border/50 flex items-center justify-center mb-6 shadow-inner">
        <Icon className="w-10 h-10 text-muted-foreground/60" />
      </div>
      <h3 className="text-lg font-semibold mb-2 text-foreground/80">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm mb-4 leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Smaller empty state for use inside filtered lists */
export function EmptyFilterState({
  message = "No items match your filter",
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-20 text-center",
        "animate-in fade-in-0 zoom-in-95 duration-500",
        className,
      )}
    >
      <div className="w-16 h-16 rounded-full bg-muted/50 border border-border/50 flex items-center justify-center mb-4 shadow-inner">
        <Music className="w-8 h-8 text-muted-foreground/60" />
      </div>
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}
