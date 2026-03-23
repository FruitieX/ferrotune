"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAtom, useSetAtom, useAtomValue } from "jotai";
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
  FolderOpen,
  MoreHorizontal,
  Filter,
  Check,
} from "lucide-react";
import {
  albumViewModeAtom,
  libraryFilterAtom,
  librarySortAtom,
  columnVisibilityAtom,
  advancedFiltersAtom,
  hasActiveFiltersAtom,
  filesSortAtom,
  filesColumnVisibilityAtom,
  libraryAlbumColumnVisibilityAtom,
  libraryArtistColumnVisibilityAtom,
  libraryGenreColumnVisibilityAtom,
  type SortField,
  type FilesSortField,
  type ColumnVisibility,
  type AlbumColumnVisibility,
  type ArtistColumnVisibility,
  type GenreColumnVisibility,
} from "@/lib/store/ui";
import {
  shuffleExcludesAtom,
  shuffleExcludesLoadingAtom,
} from "@/lib/store/shuffle-excludes";
import {
  disabledSongsAtom,
  disabledSongsLoadingAtom,
} from "@/lib/store/disabled-songs";
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
import {
  AdvancedFilterDialog,
  ActiveFilterBadges,
} from "@/components/shared/advanced-filter-dialog";
import {
  DrawerMenu,
  DrawerMenuItem,
  DrawerMenuSeparator,
  DrawerMenuCollapsible,
  DrawerMenuCollapsibleTrigger,
  DrawerMenuCollapsibleContent,
  DrawerMenuCheckboxItem,
  DrawerMenuLabel,
} from "@/components/shared/drawer-menu";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/library/albums", icon: Disc, label: "Albums" },
  { href: "/library/artists", icon: User, label: "Artists" },
  { href: "/library/songs", icon: Music, label: "Songs" },
  { href: "/library/genres", icon: Tag, label: "Genres" },
  { href: "/library/files", icon: FolderOpen, label: "Files" },
];

const sortOptions: { value: SortField; label: string }[] = [
  { value: "recommended", label: "Recommended" },
  { value: "name", label: "Title" },
  { value: "artist", label: "Artist" },
  { value: "album", label: "Album" },
  { value: "year", label: "Year" },
  { value: "dateAdded", label: "Date Added" },
  { value: "playCount", label: "Play Count" },
  { value: "lastPlayed", label: "Last Played" },
  { value: "duration", label: "Duration" },
];

const filesSortOptions: { value: FilesSortField; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "artist", label: "Artist" },
  { value: "album", label: "Album" },
  { value: "year", label: "Year" },
  { value: "duration", label: "Duration" },
  { value: "size", label: "Size" },
  { value: "dateAdded", label: "Date Added" },
];

const songColumnOptions: {
  key: keyof ColumnVisibility;
  label: string;
}[] = [
  { key: "trackNumber", label: "Track Number" },
  { key: "artist", label: "Artist" },
  { key: "album", label: "Album" },
  { key: "duration", label: "Duration" },
  { key: "playCount", label: "Play Count" },
  { key: "dateAdded", label: "Date Added" },
  { key: "lastPlayed", label: "Last Played" },
  { key: "year", label: "Year" },
  { key: "starred", label: "Favorited" },
  { key: "genre", label: "Genre" },
  { key: "bitRate", label: "Bit Rate" },
  { key: "format", label: "Format" },
  { key: "rating", label: "Rating" },
];

const albumColumnOptions: {
  key: keyof AlbumColumnVisibility;
  label: string;
}[] = [
  { key: "showIndex", label: "Row Number" },
  { key: "artist", label: "Artist" },
  { key: "year", label: "Year" },
  { key: "songCount", label: "Songs" },
  { key: "duration", label: "Duration" },
  { key: "genre", label: "Genre" },
  { key: "starred", label: "Favorited" },
  { key: "rating", label: "Rating" },
  { key: "dateAdded", label: "Date Added" },
];

const artistColumnOptions: {
  key: keyof ArtistColumnVisibility;
  label: string;
}[] = [
  { key: "showIndex", label: "Row Number" },
  { key: "albumCount", label: "Albums" },
  { key: "songCount", label: "Songs" },
  { key: "starred", label: "Favorited" },
  { key: "rating", label: "Rating" },
];

const genreColumnOptions: {
  key: keyof GenreColumnVisibility;
  label: string;
}[] = [{ key: "showIndex", label: "Row Number" }];

const filesColumnOptions: {
  key: keyof import("@/lib/store/ui").FilesColumnVisibility;
  label: string;
}[] = [
  { key: "size", label: "Size" },
  { key: "duration", label: "Duration" },
  { key: "artist", label: "Artist" },
  { key: "album", label: "Album" },
];

export default function LibraryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [viewMode, setViewMode] = useAtom(albumViewModeAtom);
  const [filter, setFilter] = useAtom(libraryFilterAtom);
  const [sortConfig, setSortConfig] = useAtom(librarySortAtom);
  const [columnVisibility, setColumnVisibility] = useAtom(columnVisibilityAtom);
  const [albumColumnVisibility, setAlbumColumnVisibility] = useAtom(
    libraryAlbumColumnVisibilityAtom,
  );
  const [artistColumnVisibility, setArtistColumnVisibility] = useAtom(
    libraryArtistColumnVisibilityAtom,
  );
  const [genreColumnVisibility, setGenreColumnVisibility] = useAtom(
    libraryGenreColumnVisibilityAtom,
  );
  const [filesSortConfig, setFilesSortConfig] = useAtom(filesSortAtom);
  const [filesColumnVisibility, setFilesColumnVisibility] = useAtom(
    filesColumnVisibilityAtom,
  );
  const setAdvancedFilters = useSetAtom(advancedFiltersAtom);
  const hasActiveFilters = useAtomValue(hasActiveFiltersAtom);
  const setShuffleExcludes = useSetAtom(shuffleExcludesAtom);
  const setShuffleExcludesLoading = useSetAtom(shuffleExcludesLoadingAtom);
  const setDisabledSongs = useSetAtom(disabledSongsAtom);
  const setDisabledSongsLoading = useSetAtom(disabledSongsLoadingAtom);

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

  // Load disabled songs on mount
  useEffect(() => {
    const loadDisabledSongs = async () => {
      const client = getClient();
      if (!client) return;

      setDisabledSongsLoading(true);
      try {
        const response = await client.getAllDisabledSongs();
        setDisabledSongs(new Set(response.songIds));
      } catch (error) {
        console.error("Failed to load disabled songs:", error);
      } finally {
        setDisabledSongsLoading(false);
      }
    };

    loadDisabledSongs();
  }, [setDisabledSongs, setDisabledSongsLoading]);

  // Measure sticky header height and set CSS variable for child sticky elements
  const stickyHeaderRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stickyHeaderRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const height = entry.contentRect.height;
      el.parentElement?.style.setProperty(
        "--sticky-header-height",
        `${height}px`,
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
  const isGenresTab = pathname === "/library/genres";
  const isFilesTab = pathname === "/library/files";
  // Files tab is "browsing" when it has a libraryId param (showing directory contents)
  const isFilesBrowsing = isFilesTab && searchParams.has("libraryId");

  // For mobile advanced filter dialog
  const [advancedFilterOpen, setAdvancedFilterOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const showAdvancedFilters = isSongsTab || isAlbumsTab || isArtistsTab;
  const filterViewType = isAlbumsTab
    ? ("albums" as const)
    : isArtistsTab
      ? ("artists" as const)
      : ("songs" as const);

  // Don't show tabs on detail pages
  const isDetailPage = pathname.includes("/details");

  // Only detail pages bypass the shared layout entirely
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

  const handleFilesSort = (field: FilesSortField) => {
    if (filesSortConfig.field === field) {
      // Toggle direction
      setFilesSortConfig({
        field,
        direction: filesSortConfig.direction === "asc" ? "desc" : "asc",
      });
    } else {
      setFilesSortConfig({ field, direction: "asc" });
    }
  };

  const toggleColumn = (key: keyof typeof columnVisibility) => {
    setColumnVisibility((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const toggleAlbumColumn = (key: keyof AlbumColumnVisibility) => {
    setAlbumColumnVisibility((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const toggleArtistColumn = (key: keyof ArtistColumnVisibility) => {
    setArtistColumnVisibility((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const toggleGenreColumn = (key: keyof GenreColumnVisibility) => {
    setGenreColumnVisibility((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const toggleFilesColumn = (key: keyof typeof filesColumnVisibility) => {
    setFilesColumnVisibility((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const SortIcon = sortConfig.direction === "asc" ? ArrowUp : ArrowDown;
  const FilesSortIcon =
    filesSortConfig.direction === "asc" ? ArrowUp : ArrowDown;

  return (
    <div>
      {/* Header + Tab Navigation - single sticky container */}
      <div
        ref={stickyHeaderRef}
        className="sticky top-0 z-30 bg-background/80 backdrop-blur-lg"
      >
        <header className="border-b border-border">
          <div className="flex items-center justify-between py-3 px-4 lg:px-6 gap-4">
            <h1 className="text-2xl font-bold shrink-0">Library</h1>

            {/* Search filter */}
            <div className="flex-1 max-w-sm flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
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
                {/* Advanced filters - desktop only */}
                {showAdvancedFilters && (
                  <AdvancedFilterDialog
                    className="hidden md:flex"
                    viewType={filterViewType}
                  />
                )}
              </div>
              {/* Active filter badges - directly below search bar */}
              {showAdvancedFilters && hasActiveFilters && (
                <ActiveFilterBadges />
              )}
            </div>

            {/* Desktop controls */}
            <div className="hidden md:flex items-center gap-2 shrink-0">
              {/* Sort dropdown - different options for files browsing */}
              {isFilesBrowsing ? (
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
                    {filesSortOptions.map((option) => (
                      <DropdownMenuItem
                        key={option.value}
                        onClick={() => handleFilesSort(option.value)}
                        className="flex items-center justify-between"
                      >
                        <span>{option.label}</span>
                        {filesSortConfig.field === option.value && (
                          <FilesSortIcon className="w-4 h-4 text-primary" />
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : !isFilesTab ? (
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
              ) : null}

              {/* Column visibility dropdown - different options for files browsing */}
              {isFilesBrowsing ? (
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
                    {filesColumnOptions.map((option) => (
                      <DropdownMenuCheckboxItem
                        key={option.key}
                        checked={
                          filesColumnVisibility[
                            option.key as keyof typeof filesColumnVisibility
                          ]
                        }
                        onCheckedChange={() =>
                          toggleFilesColumn(
                            option.key as keyof typeof filesColumnVisibility,
                          )
                        }
                      >
                        {option.label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : viewMode === "list" && !isFilesTab ? (
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
                    {isSongsTab &&
                      songColumnOptions.map((option) => (
                        <DropdownMenuCheckboxItem
                          key={option.key}
                          checked={columnVisibility[option.key]}
                          onCheckedChange={() => toggleColumn(option.key)}
                        >
                          {option.label}
                        </DropdownMenuCheckboxItem>
                      ))}
                    {isAlbumsTab &&
                      albumColumnOptions.map((option) => (
                        <DropdownMenuCheckboxItem
                          key={option.key}
                          checked={albumColumnVisibility[option.key]}
                          onCheckedChange={() => toggleAlbumColumn(option.key)}
                        >
                          {option.label}
                        </DropdownMenuCheckboxItem>
                      ))}
                    {isArtistsTab &&
                      artistColumnOptions.map((option) => (
                        <DropdownMenuCheckboxItem
                          key={option.key}
                          checked={artistColumnVisibility[option.key]}
                          onCheckedChange={() => toggleArtistColumn(option.key)}
                        >
                          {option.label}
                        </DropdownMenuCheckboxItem>
                      ))}
                    {isGenresTab &&
                      genreColumnOptions.map((option) => (
                        <DropdownMenuCheckboxItem
                          key={option.key}
                          checked={genreColumnVisibility[option.key]}
                          onCheckedChange={() => toggleGenreColumn(option.key)}
                        >
                          {option.label}
                        </DropdownMenuCheckboxItem>
                      ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}

              {/* View mode buttons - hidden on Files tab (always uses list view) */}
              {!isFilesTab && (
                <>
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
                </>
              )}
            </div>

            {/* Mobile overflow menu */}
            <div className="md:hidden shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 relative"
                aria-label="View options"
                onClick={() => setMobileMenuOpen(true)}
              >
                <MoreHorizontal className="w-4 h-4" />
                {hasActiveFilters && (
                  <span className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-primary rounded-full" />
                )}
              </Button>
              <DrawerMenu
                open={mobileMenuOpen}
                onOpenChange={setMobileMenuOpen}
                title="View Options"
              >
                {/* Advanced filters - shown only on relevant tabs */}
                {showAdvancedFilters && (
                  <>
                    <DrawerMenuItem
                      onClick={() => setAdvancedFilterOpen(true)}
                    >
                      <Filter className="w-4 h-4" />
                      Advanced Filters
                      {hasActiveFilters && (
                        <span className="ml-auto text-xs text-primary">
                          Active
                        </span>
                      )}
                    </DrawerMenuItem>
                    <DrawerMenuSeparator />
                  </>
                )}

                {/* Sort submenu */}
                {isFilesBrowsing ? (
                  <DrawerMenuCollapsible>
                    <DrawerMenuCollapsibleTrigger>
                      <ArrowUpDown className="w-4 h-4" />
                      Sort
                    </DrawerMenuCollapsibleTrigger>
                    <DrawerMenuCollapsibleContent>
                      {filesSortOptions.map((option) => (
                        <DrawerMenuItem
                          key={option.value}
                          onClick={() => handleFilesSort(option.value)}
                          className="flex items-center justify-between"
                        >
                          <span>{option.label}</span>
                          {filesSortConfig.field === option.value && (
                            <FilesSortIcon className="w-4 h-4 text-primary" />
                          )}
                        </DrawerMenuItem>
                      ))}
                    </DrawerMenuCollapsibleContent>
                  </DrawerMenuCollapsible>
                ) : !isFilesTab ? (
                  <DrawerMenuCollapsible>
                    <DrawerMenuCollapsibleTrigger>
                      <ArrowUpDown className="w-4 h-4" />
                      Sort
                    </DrawerMenuCollapsibleTrigger>
                    <DrawerMenuCollapsibleContent>
                      {sortOptions.map((option) => (
                        <DrawerMenuItem
                          key={option.value}
                          onClick={() => handleSort(option.value)}
                          className="flex items-center justify-between"
                        >
                          <span>{option.label}</span>
                          {sortConfig.field === option.value && (
                            <SortIcon className="w-4 h-4 text-primary" />
                          )}
                        </DrawerMenuItem>
                      ))}
                    </DrawerMenuCollapsibleContent>
                  </DrawerMenuCollapsible>
                ) : null}

                {/* Column visibility submenu */}
                {isFilesBrowsing ? (
                  <DrawerMenuCollapsible>
                    <DrawerMenuCollapsibleTrigger>
                      <Columns className="w-4 h-4" />
                      Columns
                    </DrawerMenuCollapsibleTrigger>
                    <DrawerMenuCollapsibleContent>
                      {filesColumnOptions.map((option) => (
                        <DrawerMenuCheckboxItem
                          key={option.key}
                          checked={
                            filesColumnVisibility[
                              option.key as keyof typeof filesColumnVisibility
                            ]
                          }
                          onCheckedChange={() =>
                            toggleFilesColumn(
                              option.key as keyof typeof filesColumnVisibility,
                            )
                          }
                        >
                          {option.label}
                        </DrawerMenuCheckboxItem>
                      ))}
                    </DrawerMenuCollapsibleContent>
                  </DrawerMenuCollapsible>
                ) : viewMode === "list" && !isFilesTab ? (
                  <DrawerMenuCollapsible>
                    <DrawerMenuCollapsibleTrigger>
                      <Columns className="w-4 h-4" />
                      Columns
                    </DrawerMenuCollapsibleTrigger>
                    <DrawerMenuCollapsibleContent>
                      {isSongsTab &&
                        songColumnOptions.map((option) => (
                          <DrawerMenuCheckboxItem
                            key={option.key}
                            checked={columnVisibility[option.key]}
                            onCheckedChange={() => toggleColumn(option.key)}
                          >
                            {option.label}
                          </DrawerMenuCheckboxItem>
                        ))}
                      {isAlbumsTab &&
                        albumColumnOptions.map((option) => (
                          <DrawerMenuCheckboxItem
                            key={option.key}
                            checked={albumColumnVisibility[option.key]}
                            onCheckedChange={() =>
                              toggleAlbumColumn(option.key)
                            }
                          >
                            {option.label}
                          </DrawerMenuCheckboxItem>
                        ))}
                      {isArtistsTab &&
                        artistColumnOptions.map((option) => (
                          <DrawerMenuCheckboxItem
                            key={option.key}
                            checked={artistColumnVisibility[option.key]}
                            onCheckedChange={() =>
                              toggleArtistColumn(option.key)
                            }
                          >
                            {option.label}
                          </DrawerMenuCheckboxItem>
                        ))}
                      {isGenresTab &&
                        genreColumnOptions.map((option) => (
                          <DrawerMenuCheckboxItem
                            key={option.key}
                            checked={genreColumnVisibility[option.key]}
                            onCheckedChange={() =>
                              toggleGenreColumn(option.key)
                            }
                          >
                            {option.label}
                          </DrawerMenuCheckboxItem>
                        ))}
                    </DrawerMenuCollapsibleContent>
                  </DrawerMenuCollapsible>
                ) : null}

                {/* View mode - hidden on Files tab */}
                {!isFilesTab && (
                  <>
                    <DrawerMenuSeparator />
                    <DrawerMenuLabel>View</DrawerMenuLabel>
                    <DrawerMenuItem onClick={() => setViewMode("grid")}>
                      <Grid className="w-4 h-4" />
                      Grid
                      {viewMode === "grid" && (
                        <Check className="w-4 h-4 ml-auto text-primary" />
                      )}
                    </DrawerMenuItem>
                    <DrawerMenuItem onClick={() => setViewMode("list")}>
                      <List className="w-4 h-4" />
                      List
                      {viewMode === "list" && (
                        <Check className="w-4 h-4 ml-auto text-primary" />
                      )}
                    </DrawerMenuItem>
                  </>
                )}
              </DrawerMenu>

              {/* Mobile advanced filter dialog (controlled) */}
              {showAdvancedFilters && (
                <AdvancedFilterDialog
                  open={advancedFilterOpen}
                  onOpenChange={setAdvancedFilterOpen}
                  showTrigger={false}
                  viewType={filterViewType}
                />
              )}
            </div>
          </div>
        </header>

        {/* Tab Navigation */}
        <nav className="border-b border-border" aria-label="Library sections">
          <div className="h-12 flex items-center px-4 lg:px-6 gap-1 overflow-x-auto scrollbar-hide">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = pathname === tab.href;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    "inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors shrink-0",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/70",
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
      </div>

      {/* Page Content */}
      {children}
    </div>
  );
}
