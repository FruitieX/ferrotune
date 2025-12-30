"use client";

import { useState, useEffect } from "react";
import { useAtom, useAtomValue } from "jotai";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Loader2,
  Check,
  RefreshCw,
  Ban,
  ImageIcon,
  X,
  FolderOpen,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { getClient } from "@/lib/api/client";
import { taggerTracksAtom, taggerSessionAtom } from "@/lib/store/tagger";
import type { PathConflict } from "@/lib/api/generated/PathConflict";
import type { MusicFolderInfo } from "@/lib/api/generated";

interface RenameEntry {
  songId: string;
  newPath: string;
}

interface TagChange {
  key: string;
  oldValue: string;
  newValue: string;
}

interface ChangeSummary {
  id: string;
  fileName: string;
  tagChanges: TagChange[];
  pathChange: { oldPath: string; newPath: string } | null;
  /** Target path - always present, either current or computed */
  targetPath: string;
  coverArtChange: "added" | "replaced" | "removed" | null;
  originalCoverArtUrl: string | null;
  newCoverArtDataUrl: string | null;
  /** Music folder path for library prefix display */
  musicFolderPath: string | null;
  isStaged: boolean;
}

interface ConflictResolution {
  songId: string;
  action: "overwrite" | "rename";
  resolvedPath: string;
}

interface SaveConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dirtyTrackIds: string[];
  onSave: (pathOverrides: Map<string, string>) => Promise<void>;
  isSaving: boolean;
}

export function SaveConfirmationDialog({
  open,
  onOpenChange,
  dirtyTrackIds,
  onSave,
  isSaving,
}: SaveConfirmationDialogProps) {
  const tracks = useAtomValue(taggerTracksAtom);
  const [session, setSession] = useAtom(taggerSessionAtom);

  const [isCheckingConflicts, setIsCheckingConflicts] = useState(false);
  const [conflicts, setConflicts] = useState<PathConflict[]>([]);
  const [resolutions, setResolutions] = useState<
    Map<string, ConflictResolution>
  >(new Map());

  // Fetch server config to check if tag editing is enabled
  const { data: serverConfig } = useQuery({
    queryKey: ["serverConfig"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getServerConfig();
    },
    staleTime: 30000,
  });

  // Fetch music folders for library selection
  const { data: musicFoldersData } = useQuery({
    queryKey: ["musicFolders"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getAdminMusicFolders();
    },
    staleTime: 30000,
    enabled: open,
  });

  const musicFolders: MusicFolderInfo[] = musicFoldersData?.musicFolders ?? [];

  // Check if there are any staged tracks in the dirty list
  const hasStagedTracks = dirtyTrackIds.some((id) => {
    const state = tracks.get(id);
    return state?.track.isStaged;
  });

  const isTagEditingDisabled = serverConfig?.readonlyTags === true;

  // State for moving existing library files to target library
  const [moveExistingFiles, setMoveExistingFiles] = useState(false);

  // Check if there are any library tracks in the dirty list
  const hasLibraryTracks = dirtyTrackIds.some((id) => {
    const state = tracks.get(id);
    return state?.track && !state.track.isStaged;
  });

  // Check for conflicts when dialog opens
  useEffect(() => {
    if (!open) {
      setConflicts([]);
      setResolutions(new Map());
      return;
    }

    // Check for conflicts asynchronously
    async function doCheck() {
      const client = getClient();
      if (!client) return;

      // Build renames list for files with path changes (only where path actually differs)
      const renames: RenameEntry[] = [];
      for (const id of dirtyTrackIds) {
        const state = tracks.get(id);
        // Only include if there's a computed path that differs from the original
        if (
          state?.computedPath &&
          !state.track.isStaged &&
          state.computedPath !== state.track.filePath
        ) {
          renames.push({
            songId: id,
            newPath: state.computedPath,
          });
        }
      }

      if (renames.length === 0) {
        setConflicts([]);
        return;
      }

      setIsCheckingConflicts(true);
      try {
        const response = await client.checkPathConflicts(renames);
        setConflicts(response.conflicts);

        // Initialize resolutions with "rename" as default
        const newResolutions = new Map<string, ConflictResolution>();
        for (const conflict of response.conflicts) {
          newResolutions.set(conflict.songId, {
            songId: conflict.songId,
            action: "rename",
            resolvedPath: conflict.suggestedPath,
          });
        }
        setResolutions(newResolutions);
      } catch (error) {
        console.error("Failed to check path conflicts:", error);
      } finally {
        setIsCheckingConflicts(false);
      }
    }

    doCheck();
  }, [open, dirtyTrackIds, tracks]);

  function getChangeSummary(): ChangeSummary[] {
    const changes: ChangeSummary[] = [];

    for (const id of dirtyTrackIds) {
      const state = tracks.get(id);
      if (!state) continue;

      const tagChanges: TagChange[] = [];
      for (const [key, newValue] of Object.entries(state.editedTags)) {
        const originalTag = state.track.tags.find((t) => t.key === key);
        tagChanges.push({
          key,
          oldValue: originalTag?.value ?? "(none)",
          newValue: newValue || "(deleted)",
        });
      }

      // Use resolved path if there's a conflict resolution
      const resolution = resolutions.get(id);
      const effectivePath = resolution
        ? resolution.resolvedPath
        : state.computedPath;

      // Target path is the effective path (if computed) or the original path
      const targetPath = effectivePath || state.track.filePath;

      const pathChange =
        effectivePath && effectivePath !== state.track.filePath
          ? { oldPath: state.track.filePath, newPath: effectivePath }
          : null;

      // Determine cover art change and get URLs
      let coverArtChange: "added" | "replaced" | "removed" | null = null;
      let originalCoverArtUrl: string | null = null;
      let newCoverArtDataUrl: string | null = null;

      if (state.coverArt?.removed) {
        coverArtChange = "removed";
      } else if (state.coverArt?.changed) {
        coverArtChange = state.track.coverArtId ? "replaced" : "added";
        newCoverArtDataUrl = state.coverArt.dataUrl ?? null;
      }

      // Get original cover art URL if track has one and it's not staged
      if (state.track.coverArtId && !state.track.isStaged) {
        const client = getClient();
        const songId = state.track.id;
        originalCoverArtUrl =
          client?.getCoverArtUrl(
            songId.startsWith("so-") ? songId : `so-${songId}`,
            "small",
          ) ?? null;
      }

      changes.push({
        id,
        fileName: state.track.filePath.split("/").pop() ?? state.track.filePath,
        tagChanges,
        pathChange,
        targetPath,
        coverArtChange,
        originalCoverArtUrl,
        newCoverArtDataUrl,
        musicFolderPath: state.track.musicFolderPath ?? null,
        isStaged: state.track.isStaged,
      });
    }

    return changes;
  }

  function handleResolutionChange(
    songId: string,
    action: "overwrite" | "rename",
  ) {
    const conflict = conflicts.find((c) => c.songId === songId);
    if (!conflict) return;

    const newResolutions = new Map(resolutions);
    newResolutions.set(songId, {
      songId,
      action,
      resolvedPath:
        action === "overwrite"
          ? conflict.requestedPath
          : conflict.suggestedPath,
    });
    setResolutions(newResolutions);
  }

  function handleSave() {
    // Build path overrides from resolutions
    const pathOverrides = new Map<string, string>();
    for (const [songId, resolution] of resolutions) {
      pathOverrides.set(songId, resolution.resolvedPath);
    }
    onSave(pathOverrides);
  }

  const changeSummary = getChangeSummary();
  const hasConflicts = conflicts.length > 0;

  // Detect if any resolved paths would result in duplicates
  // This can happen if user selects "overwrite" for multiple conflicts pointing to same path
  // or if tracks without conflicts resolve to the same path as each other or conflict resolutions
  function getDuplicatePaths(): Map<string, string[]> {
    const pathToSongIds = new Map<string, string[]>();

    for (const id of dirtyTrackIds) {
      const state = tracks.get(id);
      if (!state) continue;

      // Get the final path this track will use
      const resolution = resolutions.get(id);
      let finalPath: string;

      if (resolution) {
        // This track has a conflict resolution
        finalPath = resolution.resolvedPath;
      } else if (
        state.computedPath &&
        state.computedPath !== state.track.filePath
      ) {
        // This track has a path change but no conflict
        finalPath = state.computedPath;
      } else {
        // This track keeps its original path (no path change)
        continue;
      }

      const existing = pathToSongIds.get(finalPath) || [];
      existing.push(id);
      pathToSongIds.set(finalPath, existing);
    }

    // Filter to only keep paths with duplicates
    const duplicates = new Map<string, string[]>();
    for (const [path, songIds] of pathToSongIds) {
      if (songIds.length > 1) {
        duplicates.set(path, songIds);
      }
    }
    return duplicates;
  }

  const duplicatePaths = getDuplicatePaths();
  const hasDuplicatePaths = duplicatePaths.size > 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-6xl h-[85vh] max-h-[85vh] flex flex-col overflow-hidden">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            Confirm Changes
            {hasConflicts && (
              <span className="text-amber-500 text-sm font-normal flex items-center gap-1">
                <AlertTriangle className="w-4 h-4" />
                {conflicts.length} conflict{conflicts.length !== 1 ? "s" : ""}{" "}
                found
              </span>
            )}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                The following changes will be saved to {dirtyTrackIds.length}{" "}
                file{dirtyTrackIds.length !== 1 ? "s" : ""}:
              </p>

              {/* Library selection for staged tracks */}
              {hasStagedTracks && (
                <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50 border">
                  <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex items-center gap-2 flex-1">
                    <Label
                      htmlFor="target-library"
                      className="text-sm font-medium shrink-0"
                    >
                      Save uploads to:
                    </Label>
                    <Select
                      value={session.targetLibraryId ?? ""}
                      onValueChange={(value) =>
                        setSession((prev) => ({
                          ...prev,
                          targetLibraryId: value || null,
                        }))
                      }
                    >
                      <SelectTrigger
                        id="target-library"
                        className="w-[250px] h-8"
                      >
                        <SelectValue placeholder="Select library..." />
                      </SelectTrigger>
                      <SelectContent>
                        {musicFolders.map((folder) => (
                          <SelectItem key={folder.id} value={String(folder.id)}>
                            {folder.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {!session.targetLibraryId && (
                    <span className="text-xs text-amber-500 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Required
                    </span>
                  )}
                </div>
              )}

              {/* Move existing library files option */}
              {hasStagedTracks &&
                hasLibraryTracks &&
                session.targetLibraryId && (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50 border">
                    <Checkbox
                      id="move-existing-files"
                      checked={moveExistingFiles}
                      onCheckedChange={(checked: boolean) =>
                        setMoveExistingFiles(checked)
                      }
                    />
                    <label
                      htmlFor="move-existing-files"
                      className="text-sm font-medium cursor-pointer"
                    >
                      Also move existing library files to this library
                    </label>
                  </div>
                )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {isCheckingConflicts ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">
              Checking for conflicts...
            </span>
          </div>
        ) : (
          <>
            {/* Conflicts section */}
            {hasConflicts && (
              <div className="mb-4 p-3 border border-amber-500/50 rounded-lg bg-amber-500/5">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium text-amber-600">
                    Path Conflicts
                  </h4>
                  {conflicts.length > 1 && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        Set all to:
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => {
                          const newResolutions = new Map<
                            string,
                            ConflictResolution
                          >();
                          for (const conflict of conflicts) {
                            newResolutions.set(conflict.songId, {
                              songId: conflict.songId,
                              action: "rename",
                              resolvedPath: conflict.suggestedPath,
                            });
                          }
                          setResolutions(newResolutions);
                        }}
                      >
                        <RefreshCw className="w-3 h-3 mr-1" />
                        Add number
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-xs text-amber-600"
                        onClick={() => {
                          const newResolutions = new Map<
                            string,
                            ConflictResolution
                          >();
                          for (const conflict of conflicts) {
                            newResolutions.set(conflict.songId, {
                              songId: conflict.songId,
                              action: "overwrite",
                              resolvedPath: conflict.requestedPath,
                            });
                          }
                          setResolutions(newResolutions);
                        }}
                      >
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        Overwrite
                      </Button>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Some files already exist at the target location. Choose how to
                  handle each conflict:
                </p>
                <div className="space-y-2">
                  {conflicts.map((conflict) => {
                    const resolution = resolutions.get(conflict.songId);
                    const state = tracks.get(conflict.songId);
                    const fileName =
                      state?.track.filePath.split("/").pop() ?? conflict.songId;

                    return (
                      <div
                        key={conflict.songId}
                        className="p-2 bg-background rounded border border-border/50"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">
                              {fileName}
                            </p>
                            <p
                              className="text-xs text-red-500 truncate"
                              title={conflict.requestedPath}
                            >
                              → {conflict.requestedPath}
                            </p>
                            {resolution?.action === "rename" && (
                              <p
                                className="text-xs text-green-500 truncate"
                                title={conflict.suggestedPath}
                              >
                                Will save as: {conflict.suggestedPath}
                              </p>
                            )}
                          </div>
                          <Select
                            value={resolution?.action ?? "rename"}
                            onValueChange={(value) =>
                              handleResolutionChange(
                                conflict.songId,
                                value as "overwrite" | "rename",
                              )
                            }
                          >
                            <SelectTrigger className="w-36 h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="rename">
                                <span className="flex items-center gap-1">
                                  <RefreshCw className="w-3 h-3" />
                                  Add number
                                </span>
                              </SelectItem>
                              <SelectItem value="overwrite">
                                <span className="flex items-center gap-1 text-amber-600">
                                  <AlertTriangle className="w-3 h-3" />
                                  Overwrite
                                </span>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Duplicate paths warning */}
            {hasDuplicatePaths && (
              <div className="mb-4 p-3 border border-red-500/50 rounded-lg bg-red-500/5">
                <h4 className="text-sm font-medium text-red-600 mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Path Collision
                </h4>
                <p className="text-xs text-muted-foreground mb-3">
                  Multiple tracks are set to save to the same path. Please
                  resolve these collisions by selecting &quot;Add number&quot;
                  for at least one track in each group:
                </p>
                <div className="space-y-2">
                  {Array.from(duplicatePaths.entries()).map(
                    ([path, songIds]) => (
                      <div
                        key={path}
                        className="p-2 bg-background rounded border border-border/50"
                      >
                        <p className="text-sm font-medium text-red-500 truncate">
                          → {path}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Conflicting tracks:{" "}
                          {songIds
                            .map((id) => {
                              const state = tracks.get(id);
                              return (
                                state?.track.filePath.split("/").pop() ?? id
                              );
                            })
                            .join(", ")}
                        </p>
                      </div>
                    ),
                  )}
                </div>
              </div>
            )}

            {/* Changes list */}
            <ScrollArea className="flex-1 min-h-0">
              <div className="space-y-3 pr-4">
                {changeSummary.map((change) => (
                  <div
                    key={change.id}
                    className="p-3 border rounded-lg bg-muted/30 space-y-2"
                  >
                    <p
                      className="font-medium text-sm truncate"
                      title={change.fileName}
                    >
                      {change.fileName}
                    </p>
                    {change.tagChanges.length > 0 && (
                      <div className="space-y-1">
                        {change.tagChanges.map(
                          ({ key, oldValue, newValue }) => (
                            <div
                              key={key}
                              className="text-xs flex items-center gap-2"
                            >
                              <span className="font-medium text-muted-foreground w-24 truncate shrink-0">
                                {key}:
                              </span>
                              <span
                                className="text-red-500 line-through truncate max-w-32"
                                title={oldValue}
                              >
                                {oldValue}
                              </span>
                              <span className="text-muted-foreground">→</span>
                              <span
                                className="text-green-500 truncate max-w-32"
                                title={newValue}
                              >
                                {newValue}
                              </span>
                            </div>
                          ),
                        )}
                      </div>
                    )}
                    {/* Always show target path, show old path strikethrough only when changed */}
                    <div className="text-xs space-y-0.5">
                      <p className="text-muted-foreground">
                        {change.pathChange ? "Path:" : "Path:"}
                      </p>
                      {(() => {
                        const libraryPrefix =
                          session.showLibraryPrefix &&
                          change.musicFolderPath &&
                          !change.isStaged
                            ? `${change.musicFolderPath}/`
                            : "";
                        return (
                          <>
                            {change.pathChange && (
                              <p
                                className="text-red-500 line-through truncate"
                                title={`${libraryPrefix}${change.pathChange.oldPath}`}
                              >
                                {`${libraryPrefix}${change.pathChange.oldPath}`}
                              </p>
                            )}
                            <p
                              className={`truncate ${change.pathChange ? "text-green-500" : "text-foreground"}`}
                              title={`${libraryPrefix}${change.targetPath}`}
                            >
                              {`${libraryPrefix}${change.targetPath}`}
                            </p>
                          </>
                        );
                      })()}
                    </div>
                    {change.coverArtChange && (
                      <div className="text-xs space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <ImageIcon className="w-3 h-3 text-muted-foreground" />
                          <span className="text-muted-foreground">
                            Cover art:
                          </span>
                          <span
                            className={
                              change.coverArtChange === "removed"
                                ? "text-red-500"
                                : "text-green-500"
                            }
                          >
                            {change.coverArtChange === "added" && "Added"}
                            {change.coverArtChange === "replaced" && "Replaced"}
                            {change.coverArtChange === "removed" && "Removed"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {/* Original cover art */}
                          {change.originalCoverArtUrl ? (
                            <div className="relative w-12 h-12 rounded overflow-hidden border border-border bg-muted shrink-0">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={change.originalCoverArtUrl}
                                alt="Original cover"
                                className={`w-full h-full object-cover ${change.coverArtChange === "removed" || change.coverArtChange === "replaced" ? "opacity-50" : ""}`}
                              />
                              {(change.coverArtChange === "removed" ||
                                change.coverArtChange === "replaced") && (
                                <div className="absolute inset-0 flex items-center justify-center bg-red-500/30">
                                  <X className="w-6 h-6 text-red-500" />
                                </div>
                              )}
                            </div>
                          ) : change.coverArtChange === "added" ? (
                            <div className="w-12 h-12 rounded border border-dashed border-border bg-muted flex items-center justify-center shrink-0">
                              <ImageIcon className="w-5 h-5 text-muted-foreground/50" />
                            </div>
                          ) : null}
                          {/* Arrow */}
                          {change.coverArtChange !== "removed" && (
                            <>
                              <span className="text-muted-foreground">→</span>
                              {/* New cover art */}
                              {change.newCoverArtDataUrl ? (
                                <div className="relative w-12 h-12 rounded overflow-hidden border-2 border-green-500/50 bg-muted shrink-0">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={change.newCoverArtDataUrl}
                                    alt="New cover"
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                              ) : null}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={
                    isTagEditingDisabled ||
                    hasDuplicatePaths ||
                    (hasStagedTracks && !session.targetLibraryId)
                      ? 0
                      : undefined
                  }
                >
                  <Button
                    onClick={handleSave}
                    disabled={
                      isSaving ||
                      isCheckingConflicts ||
                      isTagEditingDisabled ||
                      hasDuplicatePaths ||
                      (hasStagedTracks && !session.targetLibraryId)
                    }
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : isTagEditingDisabled ? (
                      <>
                        <Ban className="w-4 h-4 mr-2" />
                        Tag Editing Disabled
                      </>
                    ) : hasDuplicatePaths ? (
                      <>
                        <AlertTriangle className="w-4 h-4 mr-2" />
                        Resolve Collisions
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Save Changes
                      </>
                    )}
                  </Button>
                </span>
              </TooltipTrigger>
              {isTagEditingDisabled && (
                <TooltipContent>
                  <p>
                    Tag editing is disabled in server settings.
                    <br />
                    Enable it in Administration → Server Configuration.
                  </p>
                </TooltipContent>
              )}
              {hasDuplicatePaths && !isTagEditingDisabled && (
                <TooltipContent>
                  <p>
                    Multiple tracks are set to save to the same path.
                    <br />
                    Please resolve the collisions above.
                  </p>
                </TooltipContent>
              )}
              {hasStagedTracks &&
                !session.targetLibraryId &&
                !isTagEditingDisabled &&
                !hasDuplicatePaths && (
                  <TooltipContent>
                    <p>Please select a target library for uploaded files.</p>
                  </TooltipContent>
                )}
            </Tooltip>
          </TooltipProvider>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
