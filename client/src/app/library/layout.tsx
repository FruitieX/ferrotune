"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useAtom } from "jotai";
import { Disc, User, Music, Tag, Grid, List } from "lucide-react";
import { albumViewModeAtom } from "@/lib/store/ui";
import { Button } from "@/components/ui/button";
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
  
  // Don't show tabs on detail pages
  const isDetailPage = pathname.includes("/details");
  
  if (isDetailPage) {
    return <>{children}</>;
  }

  return (
    <div>
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="flex items-center justify-between h-16 px-4 lg:px-6">
          <h1 className="text-2xl font-bold">Library</h1>

          <div className="flex items-center gap-2">
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
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
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
