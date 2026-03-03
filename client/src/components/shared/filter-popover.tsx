"use client";

import { useState, useEffect } from "react";
import { useAtom, useAtomValue } from "jotai";
import { useQuery } from "@tanstack/react-query";
import {
  Filter,
  X,
  Star,
  Clock,
  Calendar,
  Music,
  Disc,
  Shuffle,
  HardDrive,
  CalendarPlus,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  advancedFiltersAtom,
  hasActiveFiltersAtom,
  type AdvancedFilters,
} from "@/lib/store/ui";
import { getClient } from "@/lib/api/client";
import { formatDurationCompact } from "@/lib/utils/format";

interface FilterPopoverProps {
  /** Which filter options to show */
  showOptions?: {
    year?: boolean;
    genre?: boolean;
    duration?: boolean;
    rating?: boolean;
    starred?: boolean;
    playCount?: boolean;
    shuffleExcluded?: boolean;
    bitrate?: boolean;
    dateAdded?: boolean;
    library?: boolean;
  };
  className?: string;
}

export function FilterPopover({
  showOptions = {
    year: true,
    genre: true,
    duration: true,
    rating: true,
    starred: true,
    playCount: true,
    shuffleExcluded: true,
    bitrate: true,
    dateAdded: true,
    library: true,
  },
  className,
}: FilterPopoverProps) {
  const [filters, setFilters] = useAtom(advancedFiltersAtom);
  const hasActiveFilters = useAtomValue(hasActiveFiltersAtom);
  const [open, setOpen] = useState(false);

  // Local state for form inputs (allows typing without immediate API calls)
  const [localFilters, setLocalFilters] = useState<AdvancedFilters>(filters);

  // Sync local state when filters atom changes externally
  useEffect(() => {
    setLocalFilters(filters);
  }, [filters]);

  // Fetch genres for the dropdown
  // Note: Returns just the genre array for consistency with genres page query cache
  const { data: genres = [], isLoading: genresLoading } = useQuery({
    queryKey: ["genres"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getGenres();
      return response.genres?.genre ?? [];
    },
    retry: 3,
    retryDelay: 500,
  });

  // Fetch music folders for library filter
  const { data: musicFolders = [], isLoading: musicFoldersLoading } = useQuery({
    queryKey: ["musicFolders"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getAdminMusicFolders();
      return response.musicFolders ?? [];
    },
    enabled: showOptions.library,
    retry: 3,
    retryDelay: 500,
  });

  // Count active filters
  const activeFilterCount = Object.entries(filters).filter(
    ([, v]) => v !== undefined && v !== false && v !== "",
  ).length;

  const handleApply = () => {
    // Clean up empty values
    const cleanedFilters: AdvancedFilters = {};
    if (localFilters.minYear) cleanedFilters.minYear = localFilters.minYear;
    if (localFilters.maxYear) cleanedFilters.maxYear = localFilters.maxYear;
    if (localFilters.genre) cleanedFilters.genre = localFilters.genre;
    if (localFilters.minDuration)
      cleanedFilters.minDuration = localFilters.minDuration;
    if (localFilters.maxDuration)
      cleanedFilters.maxDuration = localFilters.maxDuration;
    if (localFilters.minRating)
      cleanedFilters.minRating = localFilters.minRating;
    if (localFilters.maxRating)
      cleanedFilters.maxRating = localFilters.maxRating;
    if (localFilters.starredOnly)
      cleanedFilters.starredOnly = localFilters.starredOnly;
    if (localFilters.minPlayCount)
      cleanedFilters.minPlayCount = localFilters.minPlayCount;
    if (localFilters.maxPlayCount)
      cleanedFilters.maxPlayCount = localFilters.maxPlayCount;
    if (localFilters.shuffleExcludedOnly)
      cleanedFilters.shuffleExcludedOnly = localFilters.shuffleExcludedOnly;
    if (localFilters.minBitrate)
      cleanedFilters.minBitrate = localFilters.minBitrate;
    if (localFilters.maxBitrate)
      cleanedFilters.maxBitrate = localFilters.maxBitrate;
    if (localFilters.addedAfter)
      cleanedFilters.addedAfter = localFilters.addedAfter;
    if (localFilters.addedBefore)
      cleanedFilters.addedBefore = localFilters.addedBefore;
    if (localFilters.musicFolderId != null)
      cleanedFilters.musicFolderId = localFilters.musicFolderId;

    setFilters(cleanedFilters);
    setOpen(false);
  };

  const handleClear = () => {
    setLocalFilters({});
    setFilters({});
  };

  const updateLocalFilter = <K extends keyof AdvancedFilters>(
    key: K,
    value: AdvancedFilters[K],
  ) => {
    setLocalFilters((prev) => ({
      ...prev,
      [key]: value || undefined,
    }));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={hasActiveFilters ? "default" : "outline"}
          size="sm"
          className={cn("gap-2", className)}
        >
          <Filter className="h-4 w-4" />
          <span className="hidden sm:inline">Filters</span>
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">Advanced Filters</h4>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={handleClear}>
                <X className="h-4 w-4 mr-1" />
                Clear All
              </Button>
            )}
          </div>

          {/* Year Range */}
          {showOptions.year && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                Year Range
              </Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="From"
                  min={1900}
                  max={new Date().getFullYear()}
                  value={localFilters.minYear ?? ""}
                  onChange={(e) =>
                    updateLocalFilter(
                      "minYear",
                      e.target.value ? parseInt(e.target.value) : undefined,
                    )
                  }
                  className="h-8"
                />
                <span className="text-muted-foreground self-center">–</span>
                <Input
                  type="number"
                  placeholder="To"
                  min={1900}
                  max={new Date().getFullYear()}
                  value={localFilters.maxYear ?? ""}
                  onChange={(e) =>
                    updateLocalFilter(
                      "maxYear",
                      e.target.value ? parseInt(e.target.value) : undefined,
                    )
                  }
                  className="h-8"
                />
              </div>
            </div>
          )}

          {/* Genre */}
          {showOptions.genre && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-sm">
                <Music className="h-4 w-4 text-muted-foreground" />
                Genre
              </Label>
              <Select
                value={localFilters.genre ?? "__any__"}
                onValueChange={(value) =>
                  updateLocalFilter(
                    "genre",
                    value === "__any__" ? undefined : value,
                  )
                }
                disabled={genresLoading}
              >
                <SelectTrigger className="h-8">
                  <SelectValue
                    placeholder={genresLoading ? "Loading..." : "Any genre"}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Any genre</SelectItem>
                  {genres
                    .filter((genre) => genre.value && genre.value.trim() !== "")
                    .map((genre) => (
                      <SelectItem key={genre.value} value={genre.value}>
                        {genre.value} ({genre.songCount})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Duration Range */}
          {showOptions.duration && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-muted-foreground" />
                Duration
              </Label>
              <div className="flex gap-2">
                <Select
                  value={localFilters.minDuration?.toString() ?? "__none__"}
                  onValueChange={(value) =>
                    updateLocalFilter(
                      "minDuration",
                      value === "__none__" ? undefined : parseInt(value),
                    )
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Min" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No min</SelectItem>
                    <SelectItem value="60">1 min+</SelectItem>
                    <SelectItem value="180">3 min+</SelectItem>
                    <SelectItem value="300">5 min+</SelectItem>
                    <SelectItem value="600">10 min+</SelectItem>
                    <SelectItem value="1800">30 min+</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground self-center">–</span>
                <Select
                  value={localFilters.maxDuration?.toString() ?? "__none__"}
                  onValueChange={(value) =>
                    updateLocalFilter(
                      "maxDuration",
                      value === "__none__" ? undefined : parseInt(value),
                    )
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Max" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No max</SelectItem>
                    <SelectItem value="60">1 min</SelectItem>
                    <SelectItem value="180">3 min</SelectItem>
                    <SelectItem value="300">5 min</SelectItem>
                    <SelectItem value="600">10 min</SelectItem>
                    <SelectItem value="1800">30 min</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Rating */}
          {showOptions.rating && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-sm">
                <Star className="h-4 w-4 text-muted-foreground" />
                Rating
              </Label>
              <div className="flex gap-2">
                <Select
                  value={localFilters.minRating?.toString() ?? "__none__"}
                  onValueChange={(value) =>
                    updateLocalFilter(
                      "minRating",
                      value === "__none__" ? undefined : parseInt(value),
                    )
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Min" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Any</SelectItem>
                    <SelectItem value="1">1+ ★</SelectItem>
                    <SelectItem value="2">2+ ★★</SelectItem>
                    <SelectItem value="3">3+ ★★★</SelectItem>
                    <SelectItem value="4">4+ ★★★★</SelectItem>
                    <SelectItem value="5">5 ★★★★★</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground self-center">–</span>
                <Select
                  value={localFilters.maxRating?.toString() ?? "__none__"}
                  onValueChange={(value) =>
                    updateLocalFilter(
                      "maxRating",
                      value === "__none__" ? undefined : parseInt(value),
                    )
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Max" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Any</SelectItem>
                    <SelectItem value="1">1 ★</SelectItem>
                    <SelectItem value="2">2 ★★</SelectItem>
                    <SelectItem value="3">3 ★★★</SelectItem>
                    <SelectItem value="4">4 ★★★★</SelectItem>
                    <SelectItem value="5">5 ★★★★★</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Play Count Range */}
          {showOptions.playCount && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-sm">
                <Disc className="h-4 w-4 text-muted-foreground" />
                Play Count
              </Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="Min"
                  min={0}
                  value={localFilters.minPlayCount ?? ""}
                  onChange={(e) =>
                    updateLocalFilter(
                      "minPlayCount",
                      e.target.value ? parseInt(e.target.value) : undefined,
                    )
                  }
                  className="h-8"
                />
                <span className="text-muted-foreground self-center">–</span>
                <Input
                  type="number"
                  placeholder="Max"
                  min={0}
                  value={localFilters.maxPlayCount ?? ""}
                  onChange={(e) =>
                    updateLocalFilter(
                      "maxPlayCount",
                      e.target.value ? parseInt(e.target.value) : undefined,
                    )
                  }
                  className="h-8"
                />
              </div>
            </div>
          )}

          {/* Starred Only Toggle */}
          {showOptions.starred && (
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2 text-sm cursor-pointer">
                <Star className="h-4 w-4 text-muted-foreground" />
                Favorites Only
              </Label>
              <Switch
                checked={localFilters.starredOnly ?? false}
                onCheckedChange={(checked) =>
                  updateLocalFilter("starredOnly", checked || undefined)
                }
              />
            </div>
          )}

          {/* Shuffle Excluded Only Toggle */}
          {showOptions.shuffleExcluded && (
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2 text-sm cursor-pointer">
                <Shuffle className="h-4 w-4 text-muted-foreground" />
                Shuffle Excluded Only
              </Label>
              <Switch
                checked={localFilters.shuffleExcludedOnly ?? false}
                onCheckedChange={(checked) =>
                  updateLocalFilter("shuffleExcludedOnly", checked || undefined)
                }
              />
            </div>
          )}

          {/* Bitrate Range */}
          {showOptions.bitrate && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-sm">
                <HardDrive className="h-4 w-4 text-muted-foreground" />
                Bitrate
              </Label>
              <div className="flex gap-2">
                <Select
                  value={localFilters.minBitrate?.toString() ?? "__none__"}
                  onValueChange={(value) =>
                    updateLocalFilter(
                      "minBitrate",
                      value === "__none__" ? undefined : parseInt(value),
                    )
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Min" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No min</SelectItem>
                    <SelectItem value="128">128+ kbps</SelectItem>
                    <SelectItem value="192">192+ kbps</SelectItem>
                    <SelectItem value="256">256+ kbps</SelectItem>
                    <SelectItem value="320">320+ kbps</SelectItem>
                    <SelectItem value="500">500+ kbps</SelectItem>
                    <SelectItem value="1000">1000+ kbps</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground self-center">–</span>
                <Select
                  value={localFilters.maxBitrate?.toString() ?? "__none__"}
                  onValueChange={(value) =>
                    updateLocalFilter(
                      "maxBitrate",
                      value === "__none__" ? undefined : parseInt(value),
                    )
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Max" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No max</SelectItem>
                    <SelectItem value="128">128 kbps</SelectItem>
                    <SelectItem value="192">192 kbps</SelectItem>
                    <SelectItem value="256">256 kbps</SelectItem>
                    <SelectItem value="320">320 kbps</SelectItem>
                    <SelectItem value="500">500 kbps</SelectItem>
                    <SelectItem value="1000">1000 kbps</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Date Added Range */}
          {showOptions.dateAdded && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-sm">
                <CalendarPlus className="h-4 w-4 text-muted-foreground" />
                Date Added
              </Label>
              <div className="flex gap-2">
                <Input
                  type="date"
                  placeholder="From"
                  value={localFilters.addedAfter ?? ""}
                  onChange={(e) =>
                    updateLocalFilter("addedAfter", e.target.value || undefined)
                  }
                  className="h-8"
                />
                <span className="text-muted-foreground self-center">–</span>
                <Input
                  type="date"
                  placeholder="To"
                  value={localFilters.addedBefore ?? ""}
                  onChange={(e) =>
                    updateLocalFilter(
                      "addedBefore",
                      e.target.value || undefined,
                    )
                  }
                  className="h-8"
                />
              </div>
            </div>
          )}

          {/* Library/Music Folder Filter */}
          {showOptions.library && musicFolders.length > 1 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-sm">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                Library
              </Label>
              <Select
                value={
                  localFilters.musicFolderId != null
                    ? String(localFilters.musicFolderId)
                    : "__any__"
                }
                onValueChange={(value) =>
                  updateLocalFilter(
                    "musicFolderId",
                    value === "__any__" ? undefined : Number(value),
                  )
                }
                disabled={musicFoldersLoading}
              >
                <SelectTrigger className="h-8">
                  <SelectValue
                    placeholder={
                      musicFoldersLoading ? "Loading..." : "Any library"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Any library</SelectItem>
                  {musicFolders.map((folder) => (
                    <SelectItem key={folder.id} value={String(folder.id)}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Apply Button */}
          <Button className="w-full" onClick={handleApply}>
            Apply Filters
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Shows active filter badges that can be individually removed
 */
export function ActiveFilterBadges({ className }: { className?: string }) {
  const [filters, setFilters] = useAtom(advancedFiltersAtom);
  const hasActiveFilters = useAtomValue(hasActiveFiltersAtom);

  // Fetch music folders to resolve library name from ID
  const { data: musicFolders = [] } = useQuery({
    queryKey: ["musicFolders"],
    queryFn: async () => {
      const client = getClient();
      if (!client) return [];
      const response = await client.getAdminMusicFolders();
      return response.musicFolders ?? [];
    },
  });

  if (!hasActiveFilters) return null;

  const removeFilter = (key: keyof AdvancedFilters) => {
    setFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const badges: { key: keyof AdvancedFilters; label: string }[] = [];

  if (filters.minYear || filters.maxYear) {
    const yearLabel =
      filters.minYear && filters.maxYear
        ? `${filters.minYear}–${filters.maxYear}`
        : filters.minYear
          ? `${filters.minYear}+`
          : `≤${filters.maxYear}`;
    badges.push({ key: "minYear", label: `Year: ${yearLabel}` });
  }

  if (filters.genre) {
    badges.push({ key: "genre", label: `Genre: ${filters.genre}` });
  }

  if (filters.minDuration || filters.maxDuration) {
    const durLabel =
      filters.minDuration && filters.maxDuration
        ? `${formatDurationCompact(filters.minDuration)}–${formatDurationCompact(filters.maxDuration)}`
        : filters.minDuration
          ? `${formatDurationCompact(filters.minDuration)}+`
          : `≤${formatDurationCompact(filters.maxDuration!)}`;
    badges.push({ key: "minDuration", label: `Duration: ${durLabel}` });
  }

  if (filters.minRating || filters.maxRating) {
    const ratingLabel =
      filters.minRating && filters.maxRating
        ? `${filters.minRating}–${filters.maxRating} ★`
        : filters.minRating
          ? `${filters.minRating}+ ★`
          : `≤${filters.maxRating} ★`;
    badges.push({ key: "minRating", label: `Rating: ${ratingLabel}` });
  }

  if (filters.minPlayCount || filters.maxPlayCount) {
    const pcLabel =
      filters.minPlayCount && filters.maxPlayCount
        ? `${filters.minPlayCount}–${filters.maxPlayCount}`
        : filters.minPlayCount
          ? `${filters.minPlayCount}+`
          : `≤${filters.maxPlayCount}`;
    badges.push({ key: "minPlayCount", label: `Plays: ${pcLabel}` });
  }

  if (filters.starredOnly) {
    badges.push({ key: "starredOnly", label: "Favorites Only" });
  }

  if (filters.shuffleExcludedOnly) {
    badges.push({ key: "shuffleExcludedOnly", label: "Shuffle Excluded" });
  }

  if (filters.minBitrate || filters.maxBitrate) {
    const brLabel =
      filters.minBitrate && filters.maxBitrate
        ? `${filters.minBitrate}–${filters.maxBitrate} kbps`
        : filters.minBitrate
          ? `${filters.minBitrate}+ kbps`
          : `≤${filters.maxBitrate} kbps`;
    badges.push({ key: "minBitrate", label: `Bitrate: ${brLabel}` });
  }

  if (filters.addedAfter || filters.addedBefore) {
    const dateLabel =
      filters.addedAfter && filters.addedBefore
        ? `${filters.addedAfter} – ${filters.addedBefore}`
        : filters.addedAfter
          ? `After ${filters.addedAfter}`
          : `Before ${filters.addedBefore}`;
    badges.push({ key: "addedAfter", label: `Added: ${dateLabel}` });
  }

  if (filters.musicFolderId != null) {
    const folderName =
      musicFolders.find((f) => f.id === filters.musicFolderId)?.name ??
      String(filters.musicFolderId);
    badges.push({
      key: "musicFolderId",
      label: `Library: ${folderName}`,
    });
  }

  if (filters.artistFilter) {
    badges.push({
      key: "artistFilter",
      label: `Artist: ${filters.artistFilter}`,
    });
  }

  if (filters.albumFilter) {
    badges.push({ key: "albumFilter", label: `Album: ${filters.albumFilter}` });
  }

  if (filters.titleFilter) {
    badges.push({ key: "titleFilter", label: `Title: ${filters.titleFilter}` });
  }

  if (filters.fileFormat) {
    badges.push({
      key: "fileFormat",
      label: `Format: ${filters.fileFormat.toUpperCase()}`,
    });
  }

  if (filters.missingCoverArt) {
    badges.push({ key: "missingCoverArt", label: "Missing Cover Art" });
  }

  if (filters.disabledOnly) {
    badges.push({ key: "disabledOnly", label: "Disabled Only" });
  }

  if (filters.lastPlayedAfter || filters.lastPlayedBefore) {
    const dateLabel =
      filters.lastPlayedAfter && filters.lastPlayedBefore
        ? `${filters.lastPlayedAfter} – ${filters.lastPlayedBefore}`
        : filters.lastPlayedAfter
          ? `After ${filters.lastPlayedAfter}`
          : `Before ${filters.lastPlayedBefore}`;
    badges.push({ key: "lastPlayedAfter", label: `Last Played: ${dateLabel}` });
  }

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {badges.map(({ key, label }) => (
        <Badge
          key={key}
          variant="secondary"
          className="gap-1 pr-1 cursor-pointer hover:bg-secondary/80"
          onClick={() => {
            // For range filters, remove both min and max
            if (key === "minYear") {
              removeFilter("minYear");
              removeFilter("maxYear");
            } else if (key === "minDuration") {
              removeFilter("minDuration");
              removeFilter("maxDuration");
            } else if (key === "minRating") {
              removeFilter("minRating");
              removeFilter("maxRating");
            } else if (key === "minPlayCount") {
              removeFilter("minPlayCount");
              removeFilter("maxPlayCount");
            } else if (key === "minBitrate") {
              removeFilter("minBitrate");
              removeFilter("maxBitrate");
            } else if (key === "addedAfter") {
              removeFilter("addedAfter");
              removeFilter("addedBefore");
            } else if (key === "lastPlayedAfter") {
              removeFilter("lastPlayedAfter");
              removeFilter("lastPlayedBefore");
            } else {
              removeFilter(key);
            }
          }}
        >
          {label}
          <X className="h-3 w-3 ml-1" />
        </Badge>
      ))}
    </div>
  );
}
