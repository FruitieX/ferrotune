"use client";

import { useState, useEffect } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
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
  FileAudio,
  FileCode,
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
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { getClient } from "@/lib/api/client";
import {
  taggerTracksAtom,
  taggerSessionAtom,
  taggerScriptsAtom,
} from "@/lib/store/tagger";
import { useRenameScript } from "@/lib/hooks/use-rename-script";
import type { PathConflict } from "@/lib/api/generated/PathConflict";
import type { MusicFolderInfo } from "@/lib/api/generated";

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
  /** Replacement audio filename if staged */
  replacementAudioFilename: string | null;
}

interface ConflictResolution {
  songId: string;
  action: "overwrite" | "rename";
  resolvedPath: string;
}

/** Progress state for saving tracks */
export interface SaveProgress {
  current: number;
  total: number;
  currentTrackName?: string;
}

interface SaveConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dirtyTrackIds: string[];
  onSave: (pathOverrides: Map<string, string>) => Promise<void>;
  isSaving: boolean;
  /** Progress information when saving */
  saveProgress?: SaveProgress | null;
}

export function SaveConfirmationDialog({
  open,
  onOpenChange,
  dirtyTrackIds,
  onSave,
  isSaving,
  saveProgress,
}: SaveConfirmationDialogProps) {
  const tracks = useAtomValue(taggerTracksAtom);
  const [session, setSession] = useAtom(taggerSessionAtom);
  const scripts = useAtomValue(taggerScriptsAtom);
  const setTracks = useSetAtom(taggerTracksAtom);
  const { runOnAllTracks } = useRenameScript();

  // Get only rename scripts
  const renameScripts = scripts.filter((s) => s.type === "rename");

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

  // Auto-select the library if there's only one
  useEffect(() => {
    const folders = musicFoldersData?.musicFolders;
    if (folders?.length === 1 && !session.targetLibraryId) {
      setSession((prev) => ({
        ...prev,
        targetLibraryId: String(folders[0].id),
      }));
    }
  }, [musicFoldersData?.musicFolders, session.targetLibraryId, setSession]);

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

      // Build renames list for files with path changes
      // Include both library tracks (path changes) and staged tracks (any target path)
      const renames: Array<{
        songId: string;
        newPath: string;
        targetMusicFolderId?: number;
      }> = [];

      for (const id of dirtyTrackIds) {
        const state = tracks.get(id);
        if (!state) continue;

        if (state.track.isStaged) {
          // Staged track - check the target path in the target library
          // Skip if no target library is selected
          if (!session.targetLibraryId) continue;

          // Target path is computedPath if available, otherwise the original filename
          const targetPath = state.computedPath || state.track.filePath;

          renames.push({
            songId: id,
            newPath: targetPath,
            targetMusicFolderId: parseInt(session.targetLibraryId, 10),
          });
        } else {
          // Library track - only include if there's a computed path that differs from the original
          if (
            state.computedPath &&
            state.computedPath !== state.track.filePath
          ) {
            renames.push({
              songId: id,
              newPath: state.computedPath,
            });
          }
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
  }, [open, dirtyTrackIds, tracks, session.targetLibraryId]);

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
        replacementAudioFilename: state.hasReplacementAudio
          ? (state.replacementAudioOriginalName ?? "Replacement audio staged")
          : null,
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
      } else if (state.track.isStaged) {
        // Staged track - target path is computedPath or original filename
        // Skip if no target library (can't check for duplicates without knowing where it's going)
        if (!session.targetLibraryId) continue;
        finalPath = state.computedPath || state.track.filePath;
      } else if (
        state.computedPath &&
        state.computedPath !== state.track.filePath
      ) {
        // Library track with a path change but no conflict
        finalPath = state.computedPath;
      } else {
        // Library track keeping its original path (no path change)
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

              {/* Save options row - Library selection, Rename Script, Show Library Paths */}
              <div className="flex flex-wrap items-center gap-3 p-3 rounded-md bg-muted/50 border">
                {/* Library selection for staged tracks */}
                {hasStagedTracks && (
                  <>
                    <div className="flex items-center gap-2">
                      <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                      <Label
                        htmlFor="target-library"
                        className="text-sm font-medium shrink-0"
                      >
                        Save to:
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
                        <SelectTrigger id="target-library" className="w-45 h-8">
                          <SelectValue placeholder="Select library..." />
                        </SelectTrigger>
                        <SelectContent>
                          {musicFolders.map((folder) => (
                            <SelectItem
                              key={folder.id}
                              value={String(folder.id)}
                            >
                              {folder.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {!session.targetLibraryId && (
                        <span className="text-xs text-amber-500 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Required
                        </span>
                      )}
                    </div>
                    <div className="h-6 w-px bg-border hidden sm:block" />
                  </>
                )}

                {/* Rename Script Selection */}
                <div className="flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-muted-foreground shrink-0" />
                  <Label
                    htmlFor="rename-script"
                    className="text-sm font-medium shrink-0"
                  >
                    Rename:
                  </Label>
                  <Select
                    value={session.activeRenameScriptId ?? "none"}
                    onValueChange={(value) => {
                      if (value === "none") {
                        // Deactivate
                        setSession((prev) => ({
                          ...prev,
                          activeRenameScriptId: null,
                        }));
                        // Clear computed paths
                        setTracks((prevTracks) => {
                          const newTracks = new Map(prevTracks);
                          for (const [id, state] of newTracks) {
                            if (state.computedPath) {
                              newTracks.set(id, {
                                ...state,
                                computedPath: null,
                              });
                            }
                          }
                          return newTracks;
                        });
                      } else {
                        // Activate new script
                        setSession((prev) => ({
                          ...prev,
                          activeRenameScriptId: value,
                        }));
                        runOnAllTracks(value);
                      }
                    }}
                    disabled={renameScripts.length === 0}
                  >
                    <SelectTrigger id="rename-script" className="w-40 h-8">
                      <SelectValue
                        placeholder={
                          renameScripts.length === 0 ? "No scripts" : "None"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {renameScripts.map((script) => (
                        <SelectItem key={script.id} value={script.id}>
                          {script.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="h-6 w-px bg-border hidden sm:block" />

                {/* Show Library Paths Toggle */}
                <div className="flex items-center gap-2">
                  <Label
                    htmlFor="show-library-prefix-save"
                    className="text-sm cursor-pointer"
                  >
                    Show library paths
                  </Label>
                  <Switch
                    id="show-library-prefix-save"
                    checked={session.showLibraryPrefix ?? false}
                    onCheckedChange={(checked) =>
                      setSession((prev) => ({
                        ...prev,
                        showLibraryPrefix: checked,
                      }))
                    }
                  />
                </div>
              </div>

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
                    const conflictLibraryPrefix =
                      session.showLibraryPrefix &&
                      state?.track.musicFolderPath &&
                      !state?.track.isStaged
                        ? `${state.track.musicFolderPath}/`
                        : "";

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
                              title={`${conflictLibraryPrefix}${conflict.requestedPath}`}
                            >
                              →{" "}
                              {`${conflictLibraryPrefix}${conflict.requestedPath}`}
                            </p>
                            {resolution?.action === "rename" && (
                              <p
                                className="text-xs text-green-500 truncate"
                                title={`${conflictLibraryPrefix}${conflict.suggestedPath}`}
                              >
                                Will save as:{" "}
                                {`${conflictLibraryPrefix}${conflict.suggestedPath}`}
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
                    ([path, songIds]) => {
                      const firstState = tracks.get(songIds[0]);
                      const dupLibraryPrefix =
                        session.showLibraryPrefix &&
                        firstState?.track.musicFolderPath &&
                        !firstState?.track.isStaged
                          ? `${firstState.track.musicFolderPath}/`
                          : "";
                      return (
                        <div
                          key={path}
                          className="p-2 bg-background rounded border border-border/50"
                        >
                          <p className="text-sm font-medium text-red-500 truncate">
                            → {`${dupLibraryPrefix}${path}`}
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
                      );
                    },
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
                    {change.replacementAudioFilename && (
                      <div className="text-xs">
                        <div className="flex items-center gap-1.5">
                          <FileAudio className="w-3 h-3 text-muted-foreground" />
                          <span className="text-muted-foreground">Audio:</span>
                          <span className="text-green-500 truncate">
                            Replaced with {change.replacementAudioFilename}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        )}

        <AlertDialogFooter className="flex-col gap-3 sm:flex-col">
          {/* Progress bar shown while saving */}
          {isSaving && saveProgress && (
            <div className="w-full space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Saving {saveProgress.current} of {saveProgress.total}...
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {Math.round(
                    (saveProgress.current / saveProgress.total) * 100,
                  )}
                  %
                </span>
              </div>
              <Progress
                value={(saveProgress.current / saveProgress.total) * 100}
                className="h-2"
              />
              {saveProgress.currentTrackName && (
                <p className="text-xs text-muted-foreground truncate">
                  {saveProgress.currentTrackName}
                </p>
              )}
            </div>
          )}

          <div className="flex w-full justify-end gap-2">
            <AlertDialogCancel disabled={isSaving}>Cancel</AlertDialogCancel>
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
                        saveProgress ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Saving {saveProgress.current}/{saveProgress.total}
                          </>
                        ) : (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Saving...
                          </>
                        )
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
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
