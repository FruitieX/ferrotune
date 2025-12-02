"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useAtom, useSetAtom } from "jotai";
import { Disc, User, Music, Tag, Grid, List, Search, X } from "lucide-react";
import { albumViewModeAtom, libraryFilterAtom } from "@/lib/store/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/library/albums", icon: Disc, label: "Albums" },
  { href: "/library/artists", icon: User, label: "Artists" },
  { href: "/library/songs", icon: Music, label: "Songs" },
  { href: "/library/genres", icon: Tag, label: "Genres" },
];

export default function LibraryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [viewMode, setViewMode] = useAtom(albumViewModeAtom);
  const [filter, setFilter] = useAtom(libraryFilterAtom);
  
  // Clear filter when navigating away from library
  useEffect(() => {
    return () => {
      setFilter("");
    };
  }, [setFilter]);
  
  // Don't show tabs on detail pages
  const isDetailPage = pathname.includes("/details");
  
  if (isDetailPage) {
    return <>{children}</>;
  }

  return (
    <div>
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="flex items-center justify-between h-16 px-4 lg:px-6 gap-4">
          <h1 className="text-2xl font-bold shrink-0">Library</h1>

          {/* Search filter */}
          <div className="flex-1 max-w-sm">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Filter..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="pl-9 pr-8 h-9 bg-secondary border-0 rounded-full"
              />
              {filter && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setFilter("")}
                >
                  <X className="w-3 h-3" />
                </Button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewMode("grid")}
            >
              <Grid className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewMode("list")}
            >
              <List className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="sticky top-16 z-20 bg-background border-b border-border">
        <div className="h-12 flex items-center px-4 lg:px-6 gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/70"
                )}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Page Content */}
      {children}
    </div>
  );
}
