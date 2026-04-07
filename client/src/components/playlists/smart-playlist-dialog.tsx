"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";
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
  { value: "dateAdded", label: "Date Added" },
  { value: "lastPlayed", label: "Last Played" },
  { value: "duration", label: "Duration" },
];

interface SmartPlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
      }
    }
  }

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
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
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
