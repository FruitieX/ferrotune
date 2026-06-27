"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, Sparkles, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getClient } from "@/lib/api/client";
import type { SmartPlaylistInfo } from "@/lib/api/generated/SmartPlaylistInfo";
import type { SmartPlaylistConditionApi } from "@/lib/api/generated/SmartPlaylistConditionApi";
import {
  AdvancedFilterBuilder,
  buildFieldsWithLibraries,
  buildFieldsWithPlaylistFolders,
  buildFieldsWithPlaylists,
  DEFAULT_SONG_FIELDS,
  type AdvancedFilters,
  type FilterCondition,
} from "@/components/common/advanced-filter-builder";
import { getFlatFolderList } from "@/lib/utils/playlist-folders";

// Sort field options
const SORT_FIELDS = [
  { value: "random", label: "Random" },
  { value: "title", label: "Title" },
  { value: "artist", label: "Artist" },
  { value: "album", label: "Album" },
  { value: "year", label: "Year" },
  { value: "playCount", label: "Play Count" },
  { value: "playStarts", label: "Play Starts" },
  { value: "dateAdded", label: "Date Added" },
  { value: "lastPlayed", label: "Last Played" },
  { value: "duration", label: "Duration" },
];

type SmartPlaylistPreset = {
  id: string;
  name: string;
  description: string;
  comment: string;
  logic?: "and" | "or";
  conditions: Omit<FilterCondition, "id">[];
  sortField: string;
  sortDirection: string;
  maxSongs: string;
};

const SMART_PLAYLIST_PRESETS: SmartPlaylistPreset[] = [
  {
    id: "short-term-favorites",
    name: "Short-Term Favorites",
    description: "Starred tracks you played in the last month",
    comment: "Starred tracks played within the last 30 days.",
    conditions: [
      { field: "starred", operator: "eq", value: true },
      { field: "lastPlayed", operator: "within", value: "30d" },
    ],
    sortField: "lastPlayed",
    sortDirection: "desc",
    maxSongs: "100",
  },
  {
    id: "newly-added-favorites",
    name: "Newly Added Favorites",
    description: "Starred tracks added in the last 60 days",
    comment: "Starred tracks added within the last 60 days.",
    conditions: [
      { field: "starred", operator: "eq", value: true },
      { field: "dateAdded", operator: "within", value: "60d" },
    ],
    sortField: "dateAdded",
    sortDirection: "desc",
    maxSongs: "100",
  },
  {
    id: "recent-heavy-rotation",
    name: "Recent Heavy Rotation",
    description: "Frequently played tracks from the last two weeks",
    comment: "Tracks played within the last 14 days with at least 5 plays.",
    conditions: [
      { field: "lastPlayed", operator: "within", value: "14d" },
      { field: "playCount", operator: "gte", value: 5 },
    ],
    sortField: "playCount",
    sortDirection: "desc",
    maxSongs: "100",
  },
  {
    id: "medium-term-favorites",
    name: "Medium-Term Favorites",
    description: "Starred tracks with repeat plays this half-year",
    comment: "Starred tracks played within the last 6 months at least 3 times.",
    conditions: [
      { field: "starred", operator: "eq", value: true },
      { field: "lastPlayed", operator: "within", value: "6mo" },
      { field: "playCount", operator: "gte", value: 3 },
    ],
    sortField: "playCount",
    sortDirection: "desc",
    maxSongs: "150",
  },
  {
    id: "recent-discoveries",
    name: "Recent Discoveries",
    description: "Newer listens that have not become staples yet",
    comment: "Tracks played recently with two plays or fewer.",
    conditions: [
      { field: "lastPlayed", operator: "within", value: "30d" },
      { field: "playCount", operator: "lte", value: 2 },
    ],
    sortField: "lastPlayed",
    sortDirection: "desc",
    maxSongs: "100",
  },
  {
    id: "long-term-favorites",
    name: "Long-Term Favorites",
    description: "Starred tracks with a deep play history",
    comment:
      "Starred tracks played at least 10 times, ordered by oldest play date.",
    conditions: [
      { field: "starred", operator: "eq", value: true },
      { field: "playCount", operator: "gte", value: 10 },
      { field: "lastPlayed", operator: "notEmpty", value: "" },
    ],
    sortField: "lastPlayed",
    sortDirection: "asc",
    maxSongs: "200",
  },
  {
    id: "rediscover-starred",
    name: "Rediscover Starred",
    description: "Starred tracks ordered by oldest recent listen",
    comment: "Starred tracks with play history, ordered by oldest last play.",
    conditions: [
      { field: "starred", operator: "eq", value: true },
      { field: "lastPlayed", operator: "notEmpty", value: "" },
    ],
    sortField: "lastPlayed",
    sortDirection: "asc",
    maxSongs: "150",
  },
  {
    id: "forgotten-deep-cuts",
    name: "Forgotten Deep Cuts",
    description: "Played tracks that have drifted furthest back",
    comment: "Tracks with at least 5 plays, ordered by oldest last play.",
    conditions: [
      { field: "playCount", operator: "gte", value: 5 },
      { field: "lastPlayed", operator: "notEmpty", value: "" },
    ],
    sortField: "lastPlayed",
    sortDirection: "asc",
    maxSongs: "200",
  },
  {
    id: "never-played",
    name: "Never Played",
    description: "Tracks with no listening history yet",
    comment: "Tracks that have never been played.",
    conditions: [{ field: "lastPlayed", operator: "empty", value: "" }],
    sortField: "dateAdded",
    sortDirection: "desc",
    maxSongs: "200",
  },
  {
    id: "recently-added-unplayed",
    name: "Recently Added Unplayed",
    description: "New arrivals still waiting for a first listen",
    comment:
      "Tracks added within the last 90 days that have never been played.",
    conditions: [
      { field: "dateAdded", operator: "within", value: "90d" },
      { field: "lastPlayed", operator: "empty", value: "" },
    ],
    sortField: "dateAdded",
    sortDirection: "desc",
    maxSongs: "200",
  },
  {
    id: "rated-favorites",
    name: "Rated Favorites",
    description: "Highly rated songs, highest first",
    comment: "Tracks rated 4 stars or higher.",
    conditions: [{ field: "rating", operator: "gte", value: 4 }],
    sortField: "rating",
    sortDirection: "desc",
    maxSongs: "200",
  },
  {
    id: "high-bitrate-favorites",
    name: "High-Bitrate Favorites",
    description: "Starred tracks with higher bitrate files",
    comment: "Starred tracks with bitrate at least 256 kbps.",
    conditions: [
      { field: "starred", operator: "eq", value: true },
      { field: "bitrate", operator: "gte", value: 256 },
    ],
    sortField: "bitrate",
    sortDirection: "desc",
    maxSongs: "200",
  },
  {
    id: "flac-favorites",
    name: "FLAC Favorites",
    description: "Starred lossless FLAC tracks",
    comment: "Starred tracks stored as FLAC files.",
    conditions: [
      { field: "starred", operator: "eq", value: true },
      { field: "fileFormat", operator: "eq", value: "flac" },
    ],
    sortField: "artist",
    sortDirection: "asc",
    maxSongs: "200",
  },
  {
    id: "missing-cover-art",
    name: "Missing Cover Art",
    description: "Tracks without embedded or album artwork",
    comment: "Tracks that do not have any cover art.",
    conditions: [{ field: "coverArt", operator: "neq", value: "any" }],
    sortField: "artist",
    sortDirection: "asc",
    maxSongs: "250",
  },
  {
    id: "shuffle-pool",
    name: "Shuffle Pool",
    description: "Enabled tracks that are allowed in shuffle",
    comment: "Tracks that are enabled and not excluded from shuffle.",
    conditions: [
      { field: "disabled", operator: "eq", value: false },
      { field: "shuffleExcluded", operator: "eq", value: false },
    ],
    sortField: "random",
    sortDirection: "asc",
    maxSongs: "500",
  },
  {
    id: "long-tracks",
    name: "Long Tracks",
    description: "Tracks seven minutes and longer",
    comment: "Tracks with duration at least 7 minutes.",
    conditions: [{ field: "duration", operator: "gte", value: 420 }],
    sortField: "duration",
    sortDirection: "desc",
    maxSongs: "200",
  },
  {
    id: "quick-listens",
    name: "Quick Listens",
    description: "Short tracks for low-commitment listening",
    comment: "Tracks with duration at most 2 minutes and 30 seconds.",
    conditions: [{ field: "duration", operator: "lte", value: 150 }],
    sortField: "random",
    sortDirection: "asc",
    maxSongs: "200",
  },
  {
    id: "nineties-favorites",
    name: "90s Favorites",
    description: "Starred tracks released in the 1990s",
    comment: "Starred tracks with release years from 1990 through 1999.",
    conditions: [
      { field: "starred", operator: "eq", value: true },
      { field: "year", operator: "gte", value: 1990 },
      { field: "year", operator: "lte", value: 1999 },
    ],
    sortField: "year",
    sortDirection: "asc",
    maxSongs: "200",
  },
];

interface SmartPlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlaylistUpdated?: () => void;
  /** If provided, edit this playlist instead of creating a new one */
  editPlaylist?: SmartPlaylistInfo;
  /** If provided, create the smart playlist in this folder (folder ID) */
  folderId?: string | null;
}

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

function parseConditions(
  conditions: SmartPlaylistConditionApi[],
): FilterCondition[] {
  return conditions.map((c) => ({
    id: generateId(),
    field: c.field,
    operator: c.operator,
    value: Array.isArray(c.value)
      ? (c.value as string[])
      : typeof c.value === "object"
        ? String(c.value)
        : c.value,
  }));
}

export function SmartPlaylistDialog({
  open,
  onOpenChange,
  onPlaylistUpdated,
  editPlaylist,
  folderId,
}: SmartPlaylistDialogProps) {
  const queryClient = useQueryClient();
  const isEditing = !!editPlaylist;

  // Fetch music folders for the library field
  const { data: musicFolders = [] } = useQuery({
    queryKey: ["musicFolders"],
    queryFn: async () => {
      const client = getClient();
      if (!client) return [];
      const response = await client.getAdminMusicFolders();
      return response.musicFolders ?? [];
    },
  });

  // Fetch playlists for the "In Playlist" field
  const { data: playlistFoldersData } = useQuery({
    queryKey: ["playlistFolders"],
    queryFn: async () => {
      const client = getClient();
      if (!client) return null;
      return client.getPlaylistFoldersWithStructure();
    },
  });

  // Build dynamic fields list including library, playlist, and playlist folder fields
  const fields = buildFieldsWithPlaylistFolders(
    buildFieldsWithPlaylists(
      buildFieldsWithLibraries(DEFAULT_SONG_FIELDS, musicFolders),
      playlistFoldersData?.playlists.map((p) => ({
        id: p.id,
        name: p.name,
      })) ?? [],
    ),
    getFlatFolderList(playlistFoldersData?.folders ?? []),
  );

  // Form state
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [filters, setFilters] = useState<AdvancedFilters>({
    logic: "and",
    conditions: [],
  });
  const [sortField, setSortField] = useState("random");
  const [sortDirection, setSortDirection] = useState("asc");
  const [maxSongs, setMaxSongs] = useState("");
  const [presetPickerOpen, setPresetPickerOpen] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);

  // Track previous open state to reset form
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevEditId, setPrevEditId] = useState(editPlaylist?.id);

  // Reset form when dialog opens or editPlaylist changes
  if (open !== prevOpen || editPlaylist?.id !== prevEditId) {
    setPrevOpen(open);
    setPrevEditId(editPlaylist?.id);
    if (open) {
      if (editPlaylist) {
        setName(editPlaylist.name);
        setComment(editPlaylist.comment ?? "");
        setIsPublic(editPlaylist.isPublic);
        setFilters({
          logic: (editPlaylist.rules.logic as "and" | "or") || "and",
          conditions: parseConditions(editPlaylist.rules.conditions),
        });
        setSortField(editPlaylist.sortField ?? "random");
        setSortDirection(editPlaylist.sortDirection ?? "asc");
        setMaxSongs(editPlaylist.maxSongs?.toString() ?? "");
        setSelectedPresetId(null);
        setPresetPickerOpen(false);
      } else {
        // Reset to defaults for new playlist
        setName("");
        setComment("");
        setIsPublic(false);
        setFilters({
          logic: "and",
          conditions: [
            {
              id: generateId(),
              field: "artist",
              operator: "contains",
              value: "",
            },
          ],
        });
        setSortField("random");
        setSortDirection("asc");
        setMaxSongs("");
        setSelectedPresetId(null);
        setPresetPickerOpen(false);
      }
    }
  }

  const selectedPreset = selectedPresetId
    ? SMART_PLAYLIST_PRESETS.find((preset) => preset.id === selectedPresetId)
    : undefined;

  const applyPreset = (preset: SmartPlaylistPreset) => {
    setName(preset.name);
    setComment(preset.comment);
    setIsPublic(false);
    setFilters({
      logic: preset.logic ?? "and",
      conditions: preset.conditions.map((condition) => ({
        id: generateId(),
        ...condition,
      })),
    });
    setSortField(preset.sortField);
    setSortDirection(preset.sortDirection);
    setMaxSongs(preset.maxSongs);
    setSelectedPresetId(preset.id);
    setPresetPickerOpen(false);
  };

  // Mutations
  const createMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      const apiConditions = filters.conditions.map((c) => ({
        field: c.field,
        operator: c.operator,
        value: c.value,
      }));

      return client.createSmartPlaylist({
        name,
        comment: comment || null,
        isPublic,
        rules: { conditions: apiConditions, logic: filters.logic },
        sortField: sortField === "random" ? null : sortField,
        sortDirection: sortDirection || null,
        maxSongs: maxSongs ? parseInt(maxSongs, 10) : null,
        folderId: folderId ?? null,
      });
    },
    onSuccess: () => {
      toast.success(`Smart playlist "${name}" created`);
      queryClient.invalidateQueries({ queryKey: ["smartPlaylists"] });
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(`Failed to create smart playlist: ${error.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client || !editPlaylist) throw new Error("Not connected");

      const apiConditions = filters.conditions.map((c) => ({
        field: c.field,
        operator: c.operator,
        value: c.value,
      }));

      return client.updateSmartPlaylist(editPlaylist.id, {
        name,
        comment: comment || null,
        isPublic,
        rules: { conditions: apiConditions, logic: filters.logic },
        sortField: sortField === "random" ? null : sortField,
        sortDirection: sortDirection || null,
        maxSongs: maxSongs ? parseInt(maxSongs, 10) : null,
        folderId: undefined, // Don't change folder - handled via name path convention
      });
    },
    onSuccess: () => {
      toast.success(`Smart playlist "${name}" updated`);
      queryClient.invalidateQueries({ queryKey: ["smartPlaylists"] });
      queryClient.invalidateQueries({
        queryKey: ["smartPlaylist", editPlaylist?.id],
      });
      // Invalidate all songs queries for this playlist (with any filter/sort params)
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return (
            Array.isArray(key) &&
            key[0] === "smartPlaylistSongs" &&
            key[1] === editPlaylist?.id
          );
        },
      });
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      onPlaylistUpdated?.();
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(`Failed to update smart playlist: ${error.message}`);
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  // Handlers
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || filters.conditions.length === 0) return;

    if (isEditing) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-150 max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              {isEditing ? "Edit Smart Playlist" : "Create Smart Playlist"}
            </DialogTitle>
            <DialogDescription>
              Smart playlists automatically include songs matching your rules.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {!isEditing ? (
              <div className="grid gap-2">
                <Label>Presets</Label>
                <Popover
                  open={presetPickerOpen}
                  onOpenChange={setPresetPickerOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-between gap-2"
                    >
                      <span className="min-w-0 truncate text-left">
                        {selectedPreset?.name ?? "Choose a preset"}
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-(--radix-popover-trigger-width) p-0">
                    <ScrollArea className="max-h-80">
                      <div className="grid gap-1 p-2">
                        {SMART_PLAYLIST_PRESETS.map((preset) => (
                          <Button
                            key={preset.id}
                            type="button"
                            variant="ghost"
                            className="h-auto min-h-14 flex-col items-start justify-start gap-1 whitespace-normal px-3 py-2 text-left"
                            aria-label={`Use ${preset.name} preset`}
                            onClick={() => applyPreset(preset)}
                          >
                            <span className="font-medium leading-snug">
                              {preset.name}
                            </span>
                            <span className="text-xs font-normal leading-snug text-muted-foreground">
                              {preset.description}
                            </span>
                          </Button>
                        ))}
                      </div>
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
              </div>
            ) : null}

            {/* Name */}
            <div className="grid gap-2">
              <Label htmlFor="sp-name">Name</Label>
              <Input
                id="sp-name"
                placeholder="My Smart Playlist"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Description */}
            <div className="grid gap-2">
              <Label htmlFor="sp-comment">Description (optional)</Label>
              <Textarea
                id="sp-comment"
                placeholder="Describe this playlist..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
              />
            </div>

            {/* Public toggle */}
            <div className="flex items-center gap-2">
              <Switch
                id="sp-public"
                checked={isPublic}
                onCheckedChange={setIsPublic}
              />
              <Label htmlFor="sp-public">Public playlist</Label>
            </div>

            {/* Conditions - uses shared AdvancedFilterBuilder */}
            <AdvancedFilterBuilder
              value={filters}
              onChange={setFilters}
              fields={fields}
              maxHeight="300px"
            />

            {/* Sorting */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Sort by</Label>
                <Select value={sortField} onValueChange={setSortField}>
                  <SelectTrigger>
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                  <SelectContent>
                    {SORT_FIELDS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Direction</Label>
                <Select value={sortDirection} onValueChange={setSortDirection}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asc">Ascending</SelectItem>
                    <SelectItem value="desc">Descending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Max songs */}
            <div className="grid gap-2">
              <Label htmlFor="sp-max">Max songs (optional)</Label>
              <Input
                id="sp-max"
                type="number"
                placeholder="No limit"
                value={maxSongs}
                onChange={(e) => setMaxSongs(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !name.trim() || filters.conditions.length === 0 || isPending
              }
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {isEditing ? "Saving..." : "Creating..."}
                </>
              ) : isEditing ? (
                "Save Changes"
              ) : (
                "Create"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
