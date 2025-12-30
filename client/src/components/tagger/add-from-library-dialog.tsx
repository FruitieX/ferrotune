"use client";

import { useState, useEffect, useRef } from "react";
import { useAtom } from "jotai";
import { Search, Music, Loader2, Plus, Check, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { getClient } from "@/lib/api/client";
import { toast } from "sonner";
import { useDebounce } from "@/lib/hooks/use-debounce";
import {
  taggerTracksAtom,
  taggerSessionAtom,
  createTrackState,
} from "@/lib/store/tagger";
import type { SongResponse } from "@/lib/api/generated";
import {
  AdvancedFilterBuilder,
  EMPTY_FILTERS,
  filtersToSearchParams,
  type AdvancedFilters,
} from "@/components/common/advanced-filter-builder";

interface AddFromLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddFromLibraryDialog({
  open,
  onOpenChange,
}: AddFromLibraryDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SongResponse[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  // Persist filters between dialog open/close
  const [filters, setFilters] = useState<AdvancedFilters>(EMPTY_FILTERS);

  const [tracks, setTracks] = useAtom(taggerTracksAtom);
  const [session, setSession] = useAtom(taggerSessionAtom);

  // Debounce search query like library views (300ms)
  const debouncedQuery = useDebounce(query, 300);
  const initialSearchDoneRef = useRef(false);
  // Track last clicked index for shift-click range selection
  const lastClickedIndexRef = useRef<number | null>(null);

  // Auto-search when dialog opens or debounced query/filters change
  useEffect(() => {
    if (!open) {
      initialSearchDoneRef.current = false;
      return;
    }

    const performSearch = async () => {
      const client = getClient();
      if (!client) return;

      setIsSearching(true);
      try {
        const filterParams = filtersToSearchParams(filters);
        const searchParams = {
          query: debouncedQuery.trim() || "*",
          songCount: 100,
          ...filterParams,
        };

        const response = await client.search3(searchParams);
        setResults(response.searchResult3?.song ?? []);
        // Reset last clicked when results change
        lastClickedIndexRef.current = null;
      } catch (error) {
        console.error("Search failed:", error);
        toast.error("Search failed");
      } finally {
        setIsSearching(false);
      }
    };

    // Perform search on open (initial) or when query/filters change
    performSearch();
    initialSearchDoneRef.current = true;
  }, [open, debouncedQuery, filters]);

  function handleItemClick(index: number, event: React.MouseEvent) {
    const existingIds = new Set(session.tracks.map((t) => t.id));
    const filteredResults = results.filter((r) => !existingIds.has(r.id));
    const id = filteredResults[index].id;

    if (event.shiftKey && lastClickedIndexRef.current !== null) {
      // Shift-click: select range from last clicked to current
      const start = Math.min(lastClickedIndexRef.current, index);
      const end = Math.max(lastClickedIndexRef.current, index);

      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          next.add(filteredResults[i].id);
        }
        return next;
      });
    } else {
      // Normal click: toggle single selection
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      lastClickedIndexRef.current = index;
    }
  }

  function selectAll() {
    const existingIds = new Set(session.tracks.map((t) => t.id));
    const filteredResults = results.filter((r) => !existingIds.has(r.id));
    setSelectedIds(new Set(filteredResults.map((r) => r.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
    lastClickedIndexRef.current = null;
  }

  async function addSelected() {
    const client = getClient();
    if (!client || selectedIds.size === 0) return;

    setIsAdding(true);
    try {
      const response = await client.stageLibraryTracks(Array.from(selectedIds));

      // Add tracks to state
      const newTracks = new Map(tracks);
      const newTrackIds: string[] = [];

      for (const track of response.tracks) {
        const trackState = createTrackState(track);
        newTracks.set(track.id, trackState);
        newTrackIds.push(track.id);
      }

      setTracks(newTracks);
      setSession({
        ...session,
        tracks: [
          ...session.tracks,
          ...newTrackIds.map((id) => ({ id, trackType: "library" as const })),
        ],
      });

      toast.success(`Added ${newTrackIds.length} track(s) to tagger`);

      // Close dialog but keep query and filters for next time
      onOpenChange(false);
      setSelectedIds(new Set());
    } catch (error) {
      console.error("Failed to add tracks:", error);
      toast.error("Failed to add tracks");
    } finally {
      setIsAdding(false);
    }
  }

  // Filter out already loaded tracks
  const existingIds = new Set(session.tracks.map((t) => t.id));
  const filteredResults = results.filter((r) => !existingIds.has(r.id));

  // Count active filters
  const activeFilterCount = filters.conditions.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-[900px] h-[85vh] max-h-[85vh] flex flex-col overflow-hidden select-none">
        <DialogHeader className="shrink-0">
          <DialogTitle>Add from Library</DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex flex-col min-h-0 gap-4">
          {/* Search Bar */}
          <div className="space-y-3 shrink-0">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search songs (empty for all)..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9 pr-9"
                />
                {isSearching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
                )}
              </div>
              <Button
                variant="outline"
                size="icon"
                className="relative"
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter className="w-4 h-4" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary text-primary-foreground text-[10px] rounded-full flex items-center justify-center font-medium">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </div>

            {/* Advanced Filters */}
            <Collapsible open={showFilters} onOpenChange={setShowFilters}>
              <CollapsibleContent>
                <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
                  <AdvancedFilterBuilder
                    value={filters}
                    onChange={setFilters}
                    maxHeight="250px"
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          {/* Results */}
          <div className="flex-1 min-h-0 overflow-auto space-y-1 border rounded-lg p-2">
            {filteredResults.length === 0 && results.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Music className="w-12 h-12 mb-4 opacity-50" />
                <p className="text-sm">Search for songs to add to the tagger</p>
                <p className="text-xs mt-1">
                  Use an empty search to browse all tracks, or use filters to
                  find specific songs
                </p>
              </div>
            )}

            {filteredResults.length === 0 && results.length > 0 && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Check className="w-12 h-12 mb-4 opacity-50" />
                <p className="text-sm">All search results are already loaded</p>
              </div>
            )}

            {filteredResults.map((song, index) => {
              const isSelected = selectedIds.has(song.id);
              return (
                <div
                  key={song.id}
                  className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors select-none ${
                    isSelected
                      ? "bg-primary/10 ring-1 ring-primary/30"
                      : "hover:bg-muted/50"
                  }`}
                  onClick={(e) => handleItemClick(index, e)}
                >
                  <div
                    className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                      isSelected
                        ? "bg-primary border-primary"
                        : "border-muted-foreground/50"
                    }`}
                  >
                    {isSelected && (
                      <Check className="w-3 h-3 text-primary-foreground" />
                    )}
                  </div>
                  <Music className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{song.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {song.artist} — {song.album}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                    {song.suffix && (
                      <span className="uppercase">{song.suffix}</span>
                    )}
                    {song.bitRate && <span>{song.bitRate} kbps</span>}
                    {song.year && <span>{song.year}</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Selection actions */}
          <div className="flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 text-sm">
              {filteredResults.length > 0 && (
                <>
                  <span className="text-muted-foreground">
                    {selectedIds.size} of {filteredResults.length} selected
                  </span>
                  <Button variant="ghost" size="sm" onClick={selectAll}>
                    Select All
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearSelection}
                    disabled={selectedIds.size === 0}
                  >
                    Clear
                  </Button>
                </>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={addSelected}
                disabled={selectedIds.size === 0 || isAdding}
              >
                {isAdding ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 mr-2" />
                    Add {selectedIds.size} track{selectedIds.size !== 1 && "s"}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
