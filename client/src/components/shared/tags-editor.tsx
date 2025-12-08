"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Tag,
  Plus,
  Trash2,
  Save,
  Loader2,
  AlertTriangle,
  Edit,
  Info,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { getClient } from "@/lib/api/client";
import { toast } from "sonner";
import type {
  Song,
  GetTagsResponse,
  TagEntry,
  TagChange,
  UpdateTagsRequest,
} from "@/lib/api/types";

interface TagsEditorProps {
  song: Song;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Common tag keys for quick add suggestions
const COMMON_TAGS = [
  "TITLE",
  "ARTIST",
  "ALBUM",
  "ALBUMARTIST",
  "TRACKNUMBER",
  "TRACKTOTAL",
  "DISCNUMBER",
  "DISCTOTAL",
  "YEAR",
  "DATE",
  "GENRE",
  "COMMENT",
  "COMPOSER",
  "CONDUCTOR",
  "LYRICIST",
  "BPM",
  "KEY",
  "MOOD",
  "LYRICS",
  "COPYRIGHT",
  "REPLAYGAIN_TRACK_GAIN",
  "REPLAYGAIN_TRACK_PEAK",
  "REPLAYGAIN_ALBUM_GAIN",
  "REPLAYGAIN_ALBUM_PEAK",
  "MUSICBRAINZ_TRACKID",
  "MUSICBRAINZ_ALBUMID",
  "MUSICBRAINZ_ARTISTID",
  "MUSICBRAINZ_ALBUMARTISTID",
];

export function TagsEditor({ song, open, onOpenChange }: TagsEditorProps) {
  const [tagsData, setTagsData] = useState<GetTagsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editedTags, setEditedTags] = useState<Map<string, string>>(new Map());
  const [deletedTags, setDeletedTags] = useState<Set<string>>(new Set());
  const [newTags, setNewTags] = useState<TagEntry[]>([]);
  const [newTagKey, setNewTagKey] = useState("");
  const [newTagValue, setNewTagValue] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [showAdditionalTags, setShowAdditionalTags] = useState(false);
  const queryClient = useQueryClient();

  const loadTags = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const data = await client.getSongTags(song.id);
      setTagsData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tags");
    } finally {
      setLoading(false);
    }
  }, [song.id]);

  // Load tags when dialog opens
  useEffect(() => {
    if (open && song?.id) {
      loadTags();
    }
  }, [open, song?.id, loadTags]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setEditedTags(new Map());
      setDeletedTags(new Set());
      setNewTags([]);
      setNewTagKey("");
      setNewTagValue("");
      setError(null);
    }
  }, [open]);

  // Compute changes for preview
  const changes = useMemo(() => {
    if (!tagsData) return [];

    const result: TagChange[] = [];

    // Edited tags
    for (const [key, newValue] of editedTags) {
      const original = tagsData.tags.find((t) => t.key === key);
      if (original && original.value !== newValue) {
        result.push({
          key,
          action: "set",
          oldValue: original.value,
          newValue,
        });
      }
    }

    // Deleted tags
    for (const key of deletedTags) {
      const original = tagsData.tags.find((t) => t.key === key);
      if (original) {
        result.push({
          key,
          action: "deleted",
          oldValue: original.value,
          newValue: null,
        });
      }
    }

    // New tags
    for (const tag of newTags) {
      result.push({
        key: tag.key,
        action: "set",
        oldValue: null,
        newValue: tag.value,
      });
    }

    return result;
  }, [tagsData, editedTags, deletedTags, newTags]);

  const hasChanges = changes.length > 0;
  const rescanRecommended = changes.some((c) =>
    [
      "ARTIST",
      "ALBUM",
      "ALBUMARTIST",
      "TITLE",
      "TRACKNUMBER",
      "DISCNUMBER",
      "YEAR",
      "GENRE",
    ].includes(c.key.toUpperCase()),
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      const request: UpdateTagsRequest = {
        set: [],
        delete: [],
      };

      // Add edited tags
      for (const [key, value] of editedTags) {
        const original = tagsData?.tags.find((t) => t.key === key);
        if (original && original.value !== value) {
          request.set!.push({ key, value });
        }
      }

      // Add new tags
      for (const tag of newTags) {
        request.set!.push(tag);
      }

      // Add deleted tags
      request.delete = Array.from(deletedTags);

      return client.updateSongTags(song.id, request);
    },
    onSuccess: (result) => {
      toast.success(result.message);
      if (result.rescanRecommended) {
        toast.info("Library rescan recommended to update database", {
          duration: 5000,
        });
      }
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["song", song.id] });
      queryClient.invalidateQueries({ queryKey: ["album"] });
      queryClient.invalidateQueries({ queryKey: ["artist"] });
      // Reset and reload
      setEditedTags(new Map());
      setDeletedTags(new Set());
      setNewTags([]);
      loadTags();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to save tags");
    },
  });

  function handleEditTag(key: string, value: string) {
    const newEdited = new Map(editedTags);
    newEdited.set(key, value);
    setEditedTags(newEdited);
  }

  function handleDeleteTag(key: string) {
    const newDeleted = new Set(deletedTags);
    newDeleted.add(key);
    setDeletedTags(newDeleted);
    // Remove from edited if present
    const newEdited = new Map(editedTags);
    newEdited.delete(key);
    setEditedTags(newEdited);
  }

  function handleRestoreTag(key: string) {
    const newDeleted = new Set(deletedTags);
    newDeleted.delete(key);
    setDeletedTags(newDeleted);
  }

  function handleAddTag() {
    if (!newTagKey.trim() || !newTagValue.trim()) return;

    // Check if key already exists
    const keyUpper = newTagKey.toUpperCase();
    const exists =
      tagsData?.tags.some((t) => t.key.toUpperCase() === keyUpper) ||
      newTags.some((t) => t.key.toUpperCase() === keyUpper);

    if (exists) {
      toast.error("Tag with this key already exists");
      return;
    }

    setNewTags([
      ...newTags,
      { key: newTagKey.toUpperCase(), value: newTagValue },
    ]);
    setNewTagKey("");
    setNewTagValue("");
  }

  function handleRemoveNewTag(index: number) {
    setNewTags(newTags.filter((_, i) => i !== index));
  }

  function handleSave() {
    if (hasChanges) {
      setShowConfirm(true);
    }
  }

  function confirmSave() {
    setShowConfirm(false);
    saveMutation.mutate();
  }

  // Get current value of a tag (considering edits)
  function getCurrentValue(key: string, originalValue: string): string {
    return editedTags.has(key) ? editedTags.get(key)! : originalValue;
  }

  // Check if a tag is marked for deletion
  function isDeleted(key: string): boolean {
    return deletedTags.has(key);
  }

  // Suggestions for new tag key
  const tagSuggestions = useMemo(() => {
    if (!tagsData || !newTagKey) return [];
    const existingKeys = new Set([
      ...tagsData.tags.map((t) => t.key.toUpperCase()),
      ...newTags.map((t) => t.key.toUpperCase()),
    ]);
    return COMMON_TAGS.filter(
      (t) => !existingKeys.has(t) && t.includes(newTagKey.toUpperCase()),
    ).slice(0, 5);
  }, [tagsData, newTags, newTagKey]);

  const readOnly = !tagsData?.editingEnabled;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Tag className="w-5 h-5" />
              {readOnly ? "View Tags" : "Edit Tags"}
            </DialogTitle>
            <DialogDescription>
              {song.title} - {song.artist}
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <AlertTriangle className="w-8 h-8 text-destructive" />
              <p className="text-destructive">{error}</p>
              <Button onClick={loadTags} variant="outline">
                Retry
              </Button>
            </div>
          ) : tagsData ? (
            <div className="flex-1 overflow-hidden flex flex-col gap-4 min-h-0">
              {/* File info */}
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="outline">
                  {tagsData.fileFormat.toUpperCase()}
                </Badge>
                {tagsData.tagType && (
                  <Badge variant="secondary">{tagsData.tagType}</Badge>
                )}
                {readOnly && (
                  <Badge variant="destructive" className="ml-auto">
                    <Info className="w-3 h-3 mr-1" />
                    Read-only
                  </Badge>
                )}
              </div>

              <ScrollArea className="flex-1 -mx-6 px-6">
                <div className="space-y-4">
                  {/* Primary tags */}
                  <div className="space-y-2">
                    {tagsData.tags.map((tag, index) => (
                      <TagRow
                        key={`${tag.key}-${index}`}
                        tagKey={tag.key}
                        value={getCurrentValue(tag.key, tag.value)}
                        originalValue={tag.value}
                        isDeleted={isDeleted(tag.key)}
                        isModified={
                          editedTags.has(tag.key) &&
                          editedTags.get(tag.key) !== tag.value
                        }
                        readOnly={readOnly}
                        onValueChange={(v) => handleEditTag(tag.key, v)}
                        onDelete={() => handleDeleteTag(tag.key)}
                        onRestore={() => handleRestoreTag(tag.key)}
                      />
                    ))}

                    {/* New tags */}
                    {newTags.map((tag, index) => (
                      <div
                        key={`new-${index}`}
                        className="flex items-center gap-2 p-2 rounded-md border border-green-500/30 bg-green-500/5"
                      >
                        <Badge
                          variant="outline"
                          className="shrink-0 font-mono text-xs bg-green-500/10"
                        >
                          {tag.key}
                        </Badge>
                        <span className="flex-1 text-sm truncate">
                          {tag.value}
                        </span>
                        <Badge
                          variant="secondary"
                          className="text-xs text-green-600"
                        >
                          NEW
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          onClick={() => handleRemoveNewTag(index)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  {/* Add new tag */}
                  {!readOnly && (
                    <div className="space-y-2 pt-2">
                      <Label className="text-xs text-muted-foreground">
                        Add New Tag
                      </Label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Input
                            placeholder="Key (e.g., MOOD)"
                            value={newTagKey}
                            onChange={(e) =>
                              setNewTagKey(e.target.value.toUpperCase())
                            }
                            className="font-mono text-sm"
                          />
                          {tagSuggestions.length > 0 && (
                            <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-popover border rounded-md shadow-md">
                              {tagSuggestions.map((suggestion) => (
                                <button
                                  key={suggestion}
                                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                                  onClick={() => setNewTagKey(suggestion)}
                                >
                                  {suggestion}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <Input
                          placeholder="Value"
                          value={newTagValue}
                          onChange={(e) => setNewTagValue(e.target.value)}
                          className="flex-1"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={handleAddTag}
                          disabled={!newTagKey.trim() || !newTagValue.trim()}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Additional tag blocks */}
                  {tagsData.additionalTags &&
                    tagsData.additionalTags.length > 0 && (
                      <Collapsible
                        open={showAdditionalTags}
                        onOpenChange={setShowAdditionalTags}
                      >
                        <CollapsibleTrigger asChild>
                          <Button
                            variant="ghost"
                            className="w-full justify-between"
                          >
                            <span className="text-sm text-muted-foreground">
                              Additional Tag Blocks (
                              {tagsData.additionalTags.length})
                            </span>
                            {showAdditionalTags ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="space-y-4 pt-2">
                          {tagsData.additionalTags.map((block) => (
                            <div key={block.tagType} className="space-y-2">
                              <Badge variant="outline">{block.tagType}</Badge>
                              {block.tags.map((tag, tagIndex) => (
                                <div
                                  key={`${tag.key}-${tagIndex}`}
                                  className="flex items-center gap-2 p-2 rounded-md bg-muted/50 opacity-60"
                                >
                                  <Badge
                                    variant="outline"
                                    className="shrink-0 font-mono text-xs"
                                  >
                                    {tag.key}
                                  </Badge>
                                  <span className="flex-1 text-sm truncate">
                                    {tag.value}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ))}
                          <p className="text-xs text-muted-foreground">
                            Additional tag blocks are shown for reference only.
                            Edits are applied to the primary tag block.
                          </p>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                </div>
              </ScrollArea>

              {/* Footer with save button */}
              {!readOnly && (
                <>
                  <Separator />
                  <DialogFooter className="sm:justify-between">
                    <div className="text-sm text-muted-foreground">
                      {hasChanges ? (
                        <span className="text-yellow-600 flex items-center gap-1">
                          <Edit className="w-3 h-3" />
                          {changes.length}{" "}
                          {changes.length === 1 ? "change" : "changes"} pending
                        </span>
                      ) : (
                        "No changes"
                      )}
                    </div>
                    <Button
                      onClick={handleSave}
                      disabled={!hasChanges || saveMutation.isPending}
                    >
                      {saveMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4 mr-2" />
                      )}
                      Save Changes
                    </Button>
                  </DialogFooter>
                </>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Confirmation dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Tag Changes</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>The following changes will be written to the file:</p>
                <ScrollArea className="max-h-48 rounded-md border p-2">
                  <div className="space-y-1">
                    {changes.map((change, i) => (
                      <div key={i} className="text-sm">
                        {change.action === "deleted" ? (
                          <span className="text-destructive">
                            Delete{" "}
                            <code className="bg-muted px-1 rounded">
                              {change.key}
                            </code>
                            {change.oldValue && (
                              <span className="text-muted-foreground">
                                {" "}
                                (was: {change.oldValue})
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-green-600">
                            Set{" "}
                            <code className="bg-muted px-1 rounded">
                              {change.key}
                            </code>
                            {" = "}&quot;{change.newValue}&quot;
                            {change.oldValue && (
                              <span className="text-muted-foreground">
                                {" "}
                                (was: {change.oldValue})
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
                {rescanRecommended && (
                  <div className="flex items-start gap-2 p-2 rounded-md bg-yellow-500/10 border border-yellow-500/30">
                    <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5 shrink-0" />
                    <p className="text-sm text-yellow-600">
                      Changes to artist, album, or track info will require a
                      library rescan to update the database.
                    </p>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSave}>
              Save Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface TagRowProps {
  tagKey: string;
  value: string;
  originalValue: string;
  isDeleted: boolean;
  isModified: boolean;
  readOnly: boolean;
  onValueChange: (value: string) => void;
  onDelete: () => void;
  onRestore: () => void;
}

function TagRow({
  tagKey,
  value,
  originalValue,
  isDeleted,
  isModified,
  readOnly,
  onValueChange,
  onDelete,
  onRestore,
}: TagRowProps) {
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value);

  // Sync local value when value prop changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  function handleBlur() {
    setEditing(false);
    if (localValue !== originalValue) {
      onValueChange(localValue);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      handleBlur();
    } else if (e.key === "Escape") {
      setLocalValue(value);
      setEditing(false);
    }
  }

  // Highlight ReplayGain tags
  const isReplayGain = tagKey.toUpperCase().includes("REPLAYGAIN");

  return (
    <div
      className={`flex items-center gap-2 p-2 rounded-md border transition-colors ${
        isDeleted
          ? "border-destructive/30 bg-destructive/5 opacity-60"
          : isModified
            ? "border-yellow-500/30 bg-yellow-500/5"
            : isReplayGain
              ? "border-blue-500/30 bg-blue-500/5"
              : "border-border/50 bg-muted/30"
      }`}
    >
      <Badge
        variant="outline"
        className={`shrink-0 font-mono text-xs ${
          isReplayGain ? "bg-blue-500/10 text-blue-600" : ""
        }`}
      >
        {tagKey}
      </Badge>

      {editing && !readOnly && !isDeleted ? (
        <Input
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          autoFocus
          className="flex-1 h-7 text-sm"
        />
      ) : (
        <span
          className={`flex-1 text-sm truncate ${isDeleted ? "line-through" : ""} ${
            !readOnly && !isDeleted ? "cursor-pointer hover:text-primary" : ""
          }`}
          onClick={() => !readOnly && !isDeleted && setEditing(true)}
          title={value}
        >
          {value || <span className="text-muted-foreground italic">empty</span>}
        </span>
      )}

      {isModified && !isDeleted && (
        <Badge variant="secondary" className="text-xs text-yellow-600">
          MODIFIED
        </Badge>
      )}

      {!readOnly && (
        <>
          {isDeleted ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={onRestore}
            >
              Restore
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </>
      )}
    </div>
  );
}
