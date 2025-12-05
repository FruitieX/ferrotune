"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useAtom, useSetAtom } from "jotai";
import {
  Disc,
  User,
  Music,
  Tag,
  Grid,
  List,
  Search,
  X,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Columns,
  Check,
} from "lucide-react";
import {
  albumViewModeAtom,
  libraryFilterAtom,
  librarySortAtom,
  columnVisibilityAtom,
  advancedFiltersAtom,
  type SortField,
} from "@/lib/store/ui";
import { shuffleExcludesAtom, shuffleExcludesLoadingAtom } from "@/lib/store/shuffle-excludes";
import { getClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { FilterPopover, ActiveFilterBadges } from "@/components/shared/filter-popover";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/library/albums", icon: Disc, label: "Albums" },
  { href: "/library/artists", icon: User, label: "Artists" },
  { href: "/library/songs", icon: Music, label: "Songs" },
  { href: "/library/genres", icon: Tag, label: "Genres" },
];

const sortOptions: { value: SortField; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "artist", label: "Artist" },
  { value: "year", label: "Year" },
  { value: "dateAdded", label: "Date Added" },
  { value: "playCount", label: "Play Count" },
  { value: "lastPlayed", label: "Last Played" },
  { value: "duration", label: "Duration" },
];

const columnOptions: { key: keyof import("@/lib/store/ui").ColumnVisibility; label: string }[] = [
  { key: "artist", label: "Artist" },
  { key: "album", label: "Album" },
  { key: "duration", label: "Duration" },
  { key: "playCount", label: "Play Count" },
  { key: "dateAdded", label: "Date Added" },
  { key: "year", label: "Year" },
];

export default function LibraryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [viewMode, setViewMode] = useAtom(albumViewModeAtom);
  const [filter, setFilter] = useAtom(libraryFilterAtom);
  const [sortConfig, setSortConfig] = useAtom(librarySortAtom);
  const [columnVisibility, setColumnVisibility] = useAtom(columnVisibilityAtom);
  const setAdvancedFilters = useSetAtom(advancedFiltersAtom);
  const setShuffleExcludes = useSetAtom(shuffleExcludesAtom);
  const setShuffleExcludesLoading = useSetAtom(shuffleExcludesLoadingAtom);
  
  // Load shuffle excludes on mount
  useEffect(() => {
    const loadShuffleExcludes = async () => {
      const client = getClient();
      if (!client) return;
      
      setShuffleExcludesLoading(true);
      try {
        const response = await client.getAllShuffleExcludes();
        setShuffleExcludes(new Set(response.songIds));
      } catch (error) {
        console.error("Failed to load shuffle excludes:", error);
      } finally {
        setShuffleExcludesLoading(false);
      }
    };
    
    loadShuffleExcludes();
  }, [setShuffleExcludes, setShuffleExcludesLoading]);
  
  // Clear filter when navigating away from library
  useEffect(() => {
    return () => {
      setFilter("");
      setAdvancedFilters({});
    };
  }, [setFilter, setAdvancedFilters]);
  
  // Check which library tab we're on for conditional filter options
  const isSongsTab = pathname === "/library/songs";
  const isAlbumsTab = pathname === "/library/albums";
  const isArtistsTab = pathname === "/library/artists";
  
  // Don't show tabs on detail pages
  const isDetailPage = pathname.includes("/details");
  
  if (isDetailPage) {
    return <>{children}</>;
  }

  const handleSort = (field: SortField) => {
    if (sortConfig.field === field) {
      // Toggle direction
      setSortConfig({
        field,
        direction: sortConfig.direction === "asc" ? "desc" : "asc",
      });
    } else {
      setSortConfig({ field, direction: "asc" });
    }
  };

  const toggleColumn = (key: keyof typeof columnVisibility) => {
    setColumnVisibility((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const SortIcon = sortConfig.direction === "asc" ? ArrowUp : ArrowDown;

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
                aria-label="Filter library items"
              />
              {filter && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setFilter("")}
                  aria-label="Clear filter"
                >
                  <X className="w-3 h-3" />
                </Button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Sort dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Sort options"
                >
                  <ArrowUpDown className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {sortOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={() => handleSort(option.value)}
                    className="flex items-center justify-between"
                  >
                    <span>{option.label}</span>
                    {sortConfig.field === option.value && (
                      <SortIcon className="w-4 h-4 text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Column visibility dropdown - only in list view */}
            {viewMode === "list" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Toggle columns"
                  >
                    <Columns className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel>Visible Columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {columnOptions.map((option) => (
                    <DropdownMenuCheckboxItem
                      key={option.key}
                      checked={columnVisibility[option.key as keyof typeof columnVisibility]}
                      onCheckedChange={() => toggleColumn(option.key as keyof typeof columnVisibility)}
                    >
                      {option.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewMode("grid")}
              aria-label="Grid view"
              aria-pressed={viewMode === "grid"}
            >
              <Grid className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewMode("list")}
              aria-label="List view"
              aria-pressed={viewMode === "list"}
            >
              <List className="w-4 h-4" />
            </Button>
            
            {/* Advanced filters - on songs, albums, and artists tabs */}
            {(isSongsTab || isAlbumsTab || isArtistsTab) && (
              <FilterPopover 
                showOptions={{
                  year: isSongsTab || isAlbumsTab,
                  genre: isSongsTab || isAlbumsTab,
                  duration: isSongsTab,
                  rating: isSongsTab || isAlbumsTab || isArtistsTab,
                  starred: true,
                  playCount: isSongsTab,
                  bitrate: isSongsTab,
                  dateAdded: isSongsTab,
                  shuffleExcluded: isSongsTab,
                }}
              />
            )}
          </div>
        </div>
        
        {/* Active filter badges - reserve space to prevent layout shift */}
        <div className="px-4 lg:px-6 min-h-2">
          {(isSongsTab || isAlbumsTab || isArtistsTab) && (
            <ActiveFilterBadges />
          )}
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="sticky top-[73px] z-20 bg-background/80 backdrop-blur-lg border-b border-border" aria-label="Library sections">
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
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Page Content */}
      {children}
    </div>
  );
}
