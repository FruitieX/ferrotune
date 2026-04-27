"use client";

import { useState, useEffect, useRef, DragEvent } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Button } from "@/components/ui/button";
import {
  Save,
  Loader2,
  Upload,
  Plus,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { toast } from "sonner";
import {
  taggerSessionAtom,
  taggerTracksAtom,
  taggerHasChangesAtom,
  taggerSelectedIdsAtom,
  taggerDirtyTrackIdsAtom,
  taggerPendingEditsAtom,
  taggerDetailsPanelOpenAtom,
  taggerFocusedRowIdAtom,
  createTrackState,
  getTrackTags,
  type PendingEdit,
  taggerStateLoadingAtom,
  taggerStateLoadedAtom,
  loadTaggerState,
  flushSessionSync,
} from "@/lib/store/tagger";
import { TaggerGrid } from "@/components/tagger/tagger-grid";
import { TrackDetailsPanel } from "@/components/tagger/track-details-panel";
import { ColumnSelector } from "@/components/tagger/column-selector";
import { AddFromLibraryDialog } from "@/components/tagger/add-from-library-dialog";
import { FilesDropdown } from "@/components/tagger/files-dropdown";
import { FindMisnamedDialog } from "@/components/tagger/find-misnamed-dialog";
import { TaggerOptionsDialog } from "@/components/tagger/tagger-options-dialog";
import {
  SaveConfirmationDialog,
  type SaveProgress,
} from "@/components/tagger/save-confirmation-dialog";
import { ScriptEditorDialog } from "@/components/tagger/script-editor-dialog";
import { getClient } from "@/lib/api/client";
import { useAuth } from "@/lib/hooks/use-auth";
import { useRenameScript } from "@/lib/hooks/use-rename-script";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";

interface UploadingFile {
  name: string;
  size: number;
  status: "pending" | "uploading" | "done" | "error";
}

export default function TaggerPage() {
  const { isReady } = useAuth({ redirectToLogin: true });
  const [session, setSession] = useAtom(taggerSessionAtom);
  const [tracks, setTracks] = useAtom(taggerTracksAtom);
  const [pendingEdits, setPendingEdits] = useAtom(taggerPendingEditsAtom);
  const hasChanges = useAtomValue(taggerHasChangesAtom);
  const dirtyTrackIds = useAtomValue(taggerDirtyTrackIdsAtom);
  const [selectedIds, setSelectedIds] = useAtom(taggerSelectedIdsAtom);
  const [detailsPanelOpen, setDetailsPanelOpen] = useAtom(
    taggerDetailsPanelOpenAtom,
  );
  const registerTaggerSetters = useSetAtom(taggerStateLoadingAtom);
  const taggerStateLoaded = useAtomValue(taggerStateLoadedAtom);
  const focusedRowId = useAtomValue(taggerFocusedRowIdAtom);
  const { runOnAllTracks, runOnTracks } = useRenameScript();

  const [isAddFromLibraryOpen, setIsAddFromLibraryOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<SaveProgress | null>(null);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [isSaveConfirmOpen, setIsSaveConfirmOpen] = useState(false);
  const [trackIdsToSave, setTrackIdsToSave] = useState<string[]>([]); // Specific tracks to save (empty = all dirty)
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isLoadingTracks, setIsLoadingTracks] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  // Remove confirmation state
  const [isRemoveConfirmOpen, setIsRemoveConfirmOpen] = useState(false);
  const [pendingRemoveIds, setPendingRemoveIds] = useState<string[]>([]);
  const [deleteFromStaging, setDeleteFromStaging] = useState(true);

  // One-off script dialog state
  const [isOneOffScriptOpen, setIsOneOffScriptOpen] = useState(false);

  // Find misnamed songs dialog state
  const [isFindMisnamedOpen, setIsFindMisnamedOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadingIdsRef = useRef<Set<string>>(new Set());

  // Details panel resize state
  const [detailsPanelWidth, setDetailsPanelWidth] = useState(400);
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(400);

  // Load tagger state from database on mount
  // Also check taggerStateLoaded to handle HMR cases where atoms get reset
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    // Reset hasLoadedRef if atoms were reset (e.g., after HMR)
    if (hasLoadedRef.current && !taggerStateLoaded) {
      hasLoadedRef.current = false;
    }
    if (!isReady || hasLoadedRef.current) return;
    hasLoadedRef.current = true;

    registerTaggerSetters({ type: "register" });
    loadTaggerState();
  }, [isReady, registerTaggerSetters, taggerStateLoaded]);

  // Details panel resize handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;

      // Calculate new width (dragging left = wider, dragging right = narrower)
      const delta = resizeStartXRef.current - e.clientX;
      const newWidth = Math.max(
        320,
        Math.min(800, resizeStartWidthRef.current + delta),
      );
      setDetailsPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = detailsPanelWidth;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  };

  const trackCount = tracks.size;
  const selectedCount = selectedIds.size;
  const hasStagedTracks = Array.from(tracks.values()).some(
    (t) => t.track.isStaged,
  );

  // Get the focused/selected track for footer display
  const focusedTrack = (() => {
    // Prioritize checkbox selection if only one selected
    if (selectedIds.size === 1) {
      const [id] = selectedIds;
      return tracks.get(id);
    }
    // Otherwise use focused row
    if (focusedRowId) {
      return tracks.get(focusedRowId);
    }
    return undefined;
  })();

  // Sync track edits to pendingEdits (debounced via atomWithServerStorage)
  const prevPendingEditsRef = useRef<string>("");
  useEffect(() => {
    const newPendingEdits: Record<string, PendingEdit> = {};

    for (const [id, state] of tracks) {
      if (
        Object.keys(state.editedTags).length > 0 ||
        state.computedPath ||
        state.coverArt?.removed ||
        state.coverArt?.changed
      ) {
        newPendingEdits[id] = {
          editedTags: state.editedTags,
          computedPath: state.computedPath,
          coverArtRemoved: state.coverArt?.removed ?? false,
          // hasCoverArt is set when cover art is uploaded to server
          // Local changes (coverArt.changed) need to be uploaded first
          hasCoverArt: state.coverArt?.changed ?? false,
          // hasReplacementAudio is managed by the server - preserve existing value
          hasReplacementAudio: pendingEdits[id]?.hasReplacementAudio ?? false,
        };
      }
    }

    // Only update if there are actual changes
    const newPendingStr = JSON.stringify(newPendingEdits);
    if (newPendingStr !== prevPendingEditsRef.current) {
      prevPendingEditsRef.current = newPendingStr;
      setPendingEdits(newPendingEdits);
    }
  }, [tracks, setPendingEdits, pendingEdits]);

  // Load tracks from session that aren't in the tracks map
  useEffect(() => {
    if (!isReady) return;

    // Find missing tracks (not in tracks map and not currently loading)
    const missingTracks = session.tracks.filter(
      (t) => !tracks.has(t.id) && !loadingIdsRef.current.has(t.id),
    );
    if (missingTracks.length === 0) return;

    // Separate by type
    const missingLibraryTracks = missingTracks.filter(
      (t) => t.trackType === "library",
    );
    const missingStagedTracks = missingTracks.filter(
      (t) => t.trackType === "staged",
    );

    // Mark staged track IDs as loading
    for (const track of missingStagedTracks) {
      loadingIdsRef.current.add(track.id);
    }

    // Load staged files from server (they exist on disk, just not in memory)
    if (missingStagedTracks.length > 0) {
      const loadStagedFiles = async () => {
        const client = getClient();
        if (!client) {
          for (const track of missingStagedTracks) {
            loadingIdsRef.current.delete(track.id);
          }
          return;
        }

        try {
          const response = await client.getStagedFiles();
          const stagedFilesById = new Map(response.files.map((f) => [f.id, f]));

          // Find which staged tracks exist on the server
          const foundTracks: typeof missingStagedTracks = [];
          const notFoundTracks: typeof missingStagedTracks = [];

          for (const track of missingStagedTracks) {
            if (stagedFilesById.has(track.id)) {
              foundTracks.push(track);
            } else {
              notFoundTracks.push(track);
            }
          }

          // Remove tracks that don't exist on the server from the session
          if (notFoundTracks.length > 0) {
            console.warn(
              "Staged files not found on server, removing from session:",
              notFoundTracks.map((t) => t.id),
            );
            const notFoundIds = notFoundTracks.map((t) => t.id);
            setSession((prev) => ({
              ...prev,
              tracks: prev.tracks.filter(
                (t) => !notFoundTracks.find((nt) => nt.id === t.id),
              ),
            }));
            try {
              await client.removeTaggerTracks(notFoundIds);
            } catch {
              // Ignore - tracks may already be missing from server session
            }
          }

          // Add found tracks to the tracks state
          if (foundTracks.length > 0) {
            setTracks((prev) => {
              const newTracks = new Map(prev);
              for (const track of foundTracks) {
                const stagedFile = stagedFilesById.get(track.id)!;
                const trackState = createTrackState({
                  id: stagedFile.id,
                  isStaged: true,
                  filePath: stagedFile.originalFilename,
                  fileFormat:
                    stagedFile.originalFilename.split(".").pop() ?? "unknown",
                  fileSize: stagedFile.fileSize,
                  durationMs: stagedFile.durationMs ?? BigInt(0),
                  tags: stagedFile.tags,
                  coverArtId: null,
                  musicFolderId: null,
                  musicFolderPath: null,
                });

                // Restore pending edits if any exist
                const pending = pendingEdits[track.id];
                if (pending) {
                  trackState.editedTags = pending.editedTags;
                  trackState.computedPath = pending.computedPath;
                  trackState.hasReplacementAudio = pending.hasReplacementAudio;
                  trackState.replacementAudioFilename =
                    pending.replacementAudioFilename ?? undefined;
                  trackState.replacementAudioOriginalName =
                    pending.replacementAudioOriginalName ?? undefined;
                  if (pending.coverArtRemoved) {
                    trackState.coverArt = {
                      changed: false,
                      removed: true,
                    };
                  } else if (pending.hasCoverArt) {
                    // Cover art exists on server - set URL for fetching
                    const coverArtUrl = client?.getTaggerCoverArtUrl(track.id);
                    trackState.coverArt = {
                      dataUrl: coverArtUrl,
                      changed: true,
                      removed: false,
                    };
                  }
                }

                newTracks.set(track.id, trackState);
              }
              return newTracks;
            });
          }
        } catch (error) {
          console.error("Failed to load staged files:", error);
          // Remove all missing staged tracks from session on error
          const missingStagedIds = missingStagedTracks.map((t) => t.id);
          setSession((prev) => ({
            ...prev,
            tracks: prev.tracks.filter(
              (t) => !missingStagedTracks.find((mt) => mt.id === t.id),
            ),
          }));
          try {
            await client.removeTaggerTracks(missingStagedIds);
          } catch {
            // Ignore
          }
        } finally {
          for (const track of missingStagedTracks) {
            loadingIdsRef.current.delete(track.id);
          }
        }
      };

      loadStagedFiles();
    }

    // If no library tracks to load, we're done
    if (missingLibraryTracks.length === 0) return;

    const missingIds = missingLibraryTracks.map((t) => t.id);

    // Mark as loading to prevent duplicate requests
    for (const id of missingIds) {
      loadingIdsRef.current.add(id);
    }

    const loadMissingTracks = async () => {
      const client = getClient();
      if (!client) {
        // Clear loading state if no client
        for (const id of missingIds) {
          loadingIdsRef.current.delete(id);
        }
        return;
      }

      setIsLoadingTracks(true);
      try {
        const response = await client.stageLibraryTracks(missingIds);

        // Track which IDs don't have pending edits (need script run)
        const idsWithoutPendingEdits: string[] = [];
        // Track which IDs were actually returned by the server
        const returnedIds = new Set<string>();

        setTracks((prev) => {
          const newTracks = new Map(prev);
          for (const track of response.tracks) {
            returnedIds.add(track.id);
            // Restore pending edits for this track if any exist
            const pending = pendingEdits[track.id];
            const trackState = createTrackState(track);
            if (pending) {
              trackState.editedTags = pending.editedTags;
              trackState.computedPath = pending.computedPath;
              trackState.hasReplacementAudio = pending.hasReplacementAudio;
              trackState.replacementAudioFilename =
                pending.replacementAudioFilename ?? undefined;
              trackState.replacementAudioOriginalName =
                pending.replacementAudioOriginalName ?? undefined;
              if (pending.coverArtRemoved) {
                trackState.coverArt = {
                  changed: false,
                  removed: true,
                };
              } else if (pending.hasCoverArt) {
                // Cover art exists on server - set URL for fetching
                const coverArtUrl = client?.getTaggerCoverArtUrl(track.id);
                trackState.coverArt = {
                  dataUrl: coverArtUrl,
                  changed: true,
                  removed: false,
                };
              }
            } else {
              // No pending edits - will need to run rename script
              idsWithoutPendingEdits.push(track.id);
            }
            newTracks.set(track.id, trackState);
          }
          return newTracks;
        });

        // Remove IDs that weren't returned (e.g., deleted songs) from session
        const notReturnedIds = missingIds.filter(
          (id: string) => !returnedIds.has(id),
        );
        if (notReturnedIds.length > 0) {
          console.warn(
            "Some track IDs were not found on server:",
            notReturnedIds,
          );
          setSession((prev) => ({
            ...prev,
            tracks: prev.tracks.filter((t) => !notReturnedIds.includes(t.id)),
          }));
          try {
            await client.removeTaggerTracks(notReturnedIds);
          } catch {
            // Ignore
          }
        }

        // Run the active rename script on newly added tracks (if any script is active)
        if (idsWithoutPendingEdits.length > 0) {
          runOnTracks(idsWithoutPendingEdits);
        }
      } catch (error) {
        console.error("Failed to load tracks:", error);
        // Remove failed IDs from session
        setSession((prev) => ({
          ...prev,
          tracks: prev.tracks.filter((t) => !missingIds.includes(t.id)),
        }));
        try {
          await client.removeTaggerTracks(missingIds);
        } catch {
          // Ignore
        }
        toast.error("Failed to load some tracks");
      } finally {
        // Clear loading state
        for (const id of missingIds) {
          loadingIdsRef.current.delete(id);
        }
        setIsLoadingTracks(false);
      }
    };

    loadMissingTracks();
  }, [
    isReady,
    session.tracks,
    tracks,
    setTracks,
    setSession,
    pendingEdits,
    runOnTracks,
  ]);

  // Handle file upload (from input or drop)
  async function handleFileUpload(files: File[]) {
    const client = getClient();
    if (!client || files.length === 0) return;

    const audioFiles = files.filter(
      (f) =>
        f.type.startsWith("audio/") ||
        /\.(mp3|flac|m4a|ogg|opus|wav|aac|wma)$/i.test(f.name),
    );

    if (audioFiles.length === 0) {
      toast.error("No audio files found");
      return;
    }

    // Initialize upload state and show dialog
    setUploadingFiles(
      audioFiles.map((f) => ({
        name: f.name,
        size: f.size,
        status: "pending" as const,
      })),
    );
    setIsUploadDialogOpen(true);
    setIsUploading(true);

    const newTracks = new Map(tracks);
    const newTrackIds: string[] = [];
    let hasError = false;

    // Upload files sequentially for real progress tracking
    for (let i = 0; i < audioFiles.length; i++) {
      const file = audioFiles[i];

      // Mark current file as uploading
      setUploadingFiles((prev) =>
        prev.map((f, idx) =>
          idx === i ? { ...f, status: "uploading" as const } : f,
        ),
      );

      try {
        const response = await client.uploadTaggerFile(file);

        // Process uploaded file
        for (const uploaded of response.files) {
          const track = {
            id: uploaded.id,
            isStaged: true,
            filePath: uploaded.originalFilename,
            fileFormat: uploaded.originalFilename.split(".").pop() ?? "unknown",
            fileSize: uploaded.fileSize,
            durationMs: uploaded.durationMs ?? BigInt(0),
            tags: uploaded.tags,
            coverArtId: null,
            musicFolderId: null,
            musicFolderPath: null,
          };
          newTracks.set(uploaded.id, createTrackState(track));
          newTrackIds.push(uploaded.id);
        }

        // Mark file as done
        setUploadingFiles((prev) =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: "done" as const } : f,
          ),
        );
      } catch (error) {
        console.error(`Upload failed for ${file.name}:`, error);
        hasError = true;
        // Mark file as error
        setUploadingFiles((prev) =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: "error" as const } : f,
          ),
        );
        // Continue with next file
      }
    }

    // Update tracks state with all successfully uploaded files
    if (newTrackIds.length > 0) {
      setTracks(newTracks);
      setSession({
        ...session,
        tracks: [
          ...session.tracks,
          ...newTrackIds.map((id) => ({ id, trackType: "staged" as const })),
        ],
      });

      // Explicitly add uploaded tracks to the server session via POST (append)
      // This is resilient to race conditions with loadTaggerState's async completion
      try {
        await client.addTaggerTracks(
          newTrackIds.map((id) => ({
            id,
            trackType: "staged" as const,
          })),
        );
      } catch (error) {
        console.warn("Failed to sync uploaded tracks to session:", error);
      }

      // Run the active rename script on newly uploaded tracks
      runOnTracks(newTrackIds);
    }

    setIsUploading(false);

    if (!hasError) {
      toast.success(`Uploaded ${audioFiles.length} file(s)`);
      // Close dialog after short delay
      setTimeout(() => {
        setIsUploadDialogOpen(false);
        setUploadingFiles([]);
      }, 1000);
    } else if (newTrackIds.length > 0) {
      toast.warning(
        `Uploaded ${newTrackIds.length} of ${audioFiles.length} file(s)`,
      );
      // Don't auto-close on partial success
    }
    // Don't close dialog on error so user can see what failed
  }

  // Handle file input change
  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      handleFileUpload(Array.from(e.target.files));
      e.target.value = ""; // Reset input
    }
  }

  // Drag and drop handlers
  // Use a counter to track nested drag events
  const dragCounterRef = useRef(0);

  // Reset drag state when drag ends (e.g., user presses Escape or drops outside window)
  useEffect(() => {
    function handleDragEnd() {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }

    // dragend fires when the user releases the mouse button or cancels
    document.addEventListener("dragend", handleDragEnd);
    // Also reset if a drop happens anywhere on the document (catches drops outside our container)
    document.addEventListener("drop", handleDragEnd);

    return () => {
      document.removeEventListener("dragend", handleDragEnd);
      document.removeEventListener("drop", handleDragEnd);
    };
  }, []);

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) {
      setIsDragOver(true);
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);

    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;

    const files = Array.from(e.dataTransfer.files);

    // Check if any image files were dropped
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    const audioFiles = files.filter((f) => f.type.startsWith("audio/"));

    // If images were dropped and we have selected tracks, replace their cover art
    if (imageFiles.length > 0 && selectedIds.size > 0) {
      const imageFile = imageFiles[0]; // Use first image
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        const newTracks = new Map(tracks);

        for (const id of selectedIds) {
          const state = newTracks.get(id);
          if (!state) continue;

          newTracks.set(id, {
            ...state,
            coverArt: {
              dataUrl,
              changed: true,
              removed: false,
            },
          });
        }

        setTracks(newTracks);
        toast.success(`Updated cover art for ${selectedIds.size} track(s)`);
      };
      reader.readAsDataURL(imageFile);
    }

    // Also handle audio files as before
    if (audioFiles.length > 0) {
      handleFileUpload(files);
    }
  }

  async function handleSave(pathOverrides: Map<string, string> = new Map()) {
    const client = getClient();
    if (!client || dirtyTrackIds.length === 0) return;

    // Use trackIdsToSave if set (from "Save selected"), otherwise save all dirty tracks
    const tracksToSave =
      trackIdsToSave.length > 0 ? trackIdsToSave : dirtyTrackIds;

    if (tracksToSave.length === 0) {
      toast.error("No tracks to save", {
        description: "Select tracks with pending changes to save.",
      });
      return;
    }

    // Check if there are any staged (uploaded) files that need saving
    const stagedDirtyIds = tracksToSave.filter((id) => {
      const state = tracks.get(id);
      return state?.track.isStaged;
    });

    // If there are staged files, ensure a target library is selected
    if (stagedDirtyIds.length > 0 && !session.targetLibraryId) {
      toast.error("No target library selected", {
        description:
          "Please select a target library in Options before saving uploaded files.",
      });
      return;
    }

    setIsSaving(true);
    setSaveProgress({ current: 0, total: tracksToSave.length });

    // Flush any pending debounced session sync to ensure the server
    // has the latest session state (including newly uploaded tracks)
    await flushSessionSync();

    // Convert path overrides to object for API call
    const pathOverridesObj: Record<string, string> = {};
    for (const [id, path] of pathOverrides) {
      pathOverridesObj[id] = path;
    }

    const errors: Array<{ trackId: string; error: string }> = [];
    const savedTrackIds: string[] = [];

    try {
      // Use streaming save for progress reporting
      for await (const event of client.saveTaggerPendingEditsStream(
        tracksToSave,
        pathOverridesObj,
        session.targetLibraryId ? Number(session.targetLibraryId) : undefined,
      )) {
        if (event.type === "progress") {
          // Find the track name for display
          const trackId = event.trackId;
          const trackState = trackId ? tracks.get(trackId) : undefined;
          const trackName =
            trackState?.track.filePath.split("/").pop() ?? trackId ?? "";

          setSaveProgress({
            current: event.current,
            total: event.total,
            currentTrackName: trackName,
          });
        } else if (event.type === "complete" && event.result) {
          // Final result
          if (event.result.errors.length > 0) {
            errors.push(...event.result.errors);
          }
          // Mark all tracks that were saved successfully
          const errorTrackIds = new Set(
            event.result.errors.map((e) => e.trackId),
          );
          for (const trackId of tracksToSave) {
            if (!errorTrackIds.has(trackId)) {
              savedTrackIds.push(trackId);
            }
          }

          setSaveProgress({
            current: event.total,
            total: event.total,
          });
        }
      }

      if (errors.length > 0) {
        console.error("Some saves failed:", errors);
        toast.error(`Failed to save ${errors.length} track(s)`, {
          description: errors[0]?.error,
        });
      }

      // Note: server automatically rescans saved library tracks to update cover art/metadata

      // Clear edited state for saved tracks and update track data
      const newTracks = new Map(tracks);
      for (const id of savedTrackIds) {
        const state = newTracks.get(id);
        if (!state) continue;

        if (state.track.isStaged) {
          // Staged files are removed from tagger after successful save
          newTracks.delete(id);
        } else {
          // Merge edited tags into the track's tags array
          const updatedTags = [...state.track.tags];
          for (const [key, value] of Object.entries(state.editedTags)) {
            const existingIdx = updatedTags.findIndex((t) => t.key === key);
            if (existingIdx >= 0) {
              updatedTags[existingIdx] = { key, value };
            } else {
              updatedTags.push({ key, value });
            }
          }

          // Update file path if renamed - use override if available
          const newPath =
            pathOverrides.get(id) || state.computedPath || state.track.filePath;

          // If cover art was modified, update coverArtId with a timestamp to bust browser cache
          const coverArtWasModified =
            state.coverArt?.changed || state.coverArt?.removed;
          const newCoverArtId = coverArtWasModified
            ? state.coverArt?.removed
              ? null // Cover art was removed
              : `${state.track.coverArtId || id}_${Date.now()}` // Add timestamp to bust cache
            : state.track.coverArtId;

          newTracks.set(id, {
            ...state,
            track: {
              ...state.track,
              tags: updatedTags,
              filePath: newPath,
              coverArtId: newCoverArtId,
            },
            editedTags: {},
            computedPath: null,
            coverArt: null,
            hasReplacementAudio: false,
            replacementAudioFilename: undefined,
            replacementAudioOriginalName: undefined,
          });
        }
      }

      // Update session to remove saved staged tracks
      const savedStagedIds = savedTrackIds.filter((id) =>
        stagedDirtyIds.includes(id),
      );
      setSession({
        ...session,
        tracks: session.tracks.filter((t) => !savedStagedIds.includes(t.id)),
      });
      // Explicitly remove saved staged tracks from server session
      if (savedStagedIds.length > 0) {
        try {
          await client.removeTaggerTracks(savedStagedIds);
        } catch (error) {
          console.warn(
            "Failed to remove saved tracks from server session:",
            error,
          );
        }
      }

      setTracks(newTracks);

      if (savedTrackIds.length > 0) {
        toast.success(
          savedTrackIds.length === 1
            ? "Changes saved"
            : `Saved ${savedTrackIds.length} tracks`,
        );
      }
    } catch (error) {
      console.error("Save failed:", error);
      toast.error("Failed to save changes");
    } finally {
      setIsSaving(false);
      setSaveProgress(null);
      setIsSaveConfirmOpen(false);
    }
  }

  function handleClearAll() {
    setIsClearConfirmOpen(false);
    const allTrackIds = Array.from(tracks.keys());
    if (allTrackIds.length > 0) {
      doRemoveTracks(allTrackIds, deleteFromStaging);
    }
  }

  function handleRemoveSelected() {
    // Use handleRemoveTracks which properly handles staged files
    handleRemoveTracks(Array.from(selectedIds));
  }

  // Context menu handlers - shows confirmation dialog when staged files are involved
  function handleRemoveTracks(trackIds: string[]) {
    // Check if any tracks are staged
    const hasStagedTracks = trackIds.some((id) => {
      const state = tracks.get(id);
      return state?.track.isStaged;
    });

    if (hasStagedTracks) {
      // Show confirmation for staged files
      setPendingRemoveIds(trackIds);
      setDeleteFromStaging(true); // Default to delete from staging
      setIsRemoveConfirmOpen(true);
    } else {
      // No staged files, remove immediately
      doRemoveTracks(trackIds, false);
    }
  }

  // Actually remove tracks (called after confirmation)
  async function doRemoveTracks(trackIds: string[], deleteStaged: boolean) {
    const client = getClient();

    // If deleting from staging, delete staged files from server first
    if (deleteStaged && client) {
      const stagedIds = trackIds.filter((id) => {
        const state = tracks.get(id);
        return state?.track.isStaged;
      });

      for (const id of stagedIds) {
        try {
          await client.deleteStagedFile(id);
        } catch (error) {
          console.error(`Failed to delete staged file ${id}:`, error);
          // Continue with removal from tagger even if server deletion fails
        }
      }
    }

    const newTracks = new Map(tracks);
    for (const id of trackIds) {
      newTracks.delete(id);
    }
    setTracks(newTracks);
    setSession({
      ...session,
      tracks: session.tracks.filter((t) => !trackIds.includes(t.id)),
    });
    // Explicitly remove tracks from server session
    if (client) {
      try {
        await client.removeTaggerTracks(trackIds);
      } catch (error) {
        console.warn("Failed to remove tracks from server session:", error);
      }
    }
    // Clear selection if any removed tracks were selected
    const newSelectedIds = new Set(selectedIds);
    for (const id of trackIds) {
      newSelectedIds.delete(id);
    }
    setSelectedIds(newSelectedIds);
    toast.success(
      `Removed ${trackIds.length} track${trackIds.length > 1 ? "s" : ""} from tagger`,
    );
  }

  function confirmRemoveTracks() {
    doRemoveTracks(pendingRemoveIds, deleteFromStaging);
    setIsRemoveConfirmOpen(false);
    setPendingRemoveIds([]);
  }

  async function handleRevertTracks(trackIds: string[]) {
    const client = getClient();
    const newTracks = new Map(tracks);

    for (const id of trackIds) {
      const state = newTracks.get(id);
      if (state) {
        // If cover art was changed (uploaded), delete the staged file
        if (state.coverArt?.changed && client) {
          try {
            await client.deleteTaggerCoverArt(id);
          } catch (error) {
            console.warn(`Failed to delete staged cover art for ${id}:`, error);
          }
        }

        newTracks.set(id, {
          ...state,
          editedTags: {},
          computedPath: null,
          coverArt: null, // Reset cover art changes
        });
      }
    }
    setTracks(newTracks);
    toast.success(
      `Discarded changes on ${trackIds.length} track${trackIds.length > 1 ? "s" : ""}`,
    );
  }

  function handleSaveTracks(trackIds: string[]) {
    // Filter to only tracks with changes
    const tracksToSave = trackIds.filter((id) => dirtyTrackIds.includes(id));
    if (tracksToSave.length === 0) {
      toast.info("No changes to save on selected tracks");
      return;
    }

    // Run rename script first to ensure paths are up-to-date
    runOnAllTracks();

    // Set specific track IDs and open dialog
    setTrackIdsToSave(tracksToSave);
    setIsSaveConfirmOpen(true);
  }

  // Handle running one-off script on selected tracks
  function handleRunOneOffScript(code: string, scriptType: "rename" | "tags") {
    // Get target track IDs (selected or focused)
    let targetIds: string[] = [];
    if (selectedIds.size > 0) {
      targetIds = Array.from(selectedIds);
    } else if (focusedRowId) {
      targetIds = [focusedRowId];
    } else {
      toast.info("Select tracks first to run the script");
      return;
    }

    if (scriptType === "tags") {
      // For tag scripts, run the script and apply the changes
      let updatedCount = 0;
      setTracks((prev) => {
        const newTracks = new Map(prev);
        for (const id of targetIds) {
          const state = newTracks.get(id);
          if (!state) continue;

          const tags = getTrackTags(state);
          const filePath = state.track.filePath;
          const parts = filePath.split("/");
          const fullFilename = parts[parts.length - 1];
          const dotIdx = fullFilename.lastIndexOf(".");
          const filename =
            dotIdx > 0 ? fullFilename.slice(0, dotIdx) : fullFilename;
          const ext = dotIdx > 0 ? fullFilename.slice(dotIdx + 1) : "";

          try {
            const context: Record<string, string> = {
              filename,
              ext,
              filepath: filePath,
              title: tags.TITLE ?? "",
              artist: tags.ARTIST ?? "",
              albumartist: tags.ALBUMARTIST ?? "",
              album: tags.ALBUM ?? "",
              genre: tags.GENRE ?? "",
              year: tags.YEAR ?? "",
              tracknumber: tags.TRACKNUMBER ?? "",
              tracktotal: tags.TRACKTOTAL ?? "",
              discnumber: tags.DISCNUMBER ?? "",
              disctotal: tags.DISCTOTAL ?? "",
              comment: tags.COMMENT ?? "",
              composer: tags.COMPOSER ?? "",
            };

            const fn = new Function(...Object.keys(context), code);
            const result = fn(...Object.values(context));

            if (result && typeof result === "object") {
              const newEditedTags = { ...state.editedTags };
              for (const [key, value] of Object.entries(result)) {
                if (typeof value === "string") {
                  newEditedTags[key.toUpperCase()] = value;
                }
              }
              newTracks.set(id, {
                ...state,
                editedTags: newEditedTags,
              });
              updatedCount++;
            }
          } catch (e) {
            console.error(`Script error on ${id}:`, e);
          }
        }
        return newTracks;
      });

      toast.success(
        `Applied script to ${updatedCount} track${updatedCount !== 1 ? "s" : ""}`,
      );
    } else {
      // For rename scripts, compute paths
      setTracks((prev) => {
        const newTracks = new Map(prev);
        for (const id of targetIds) {
          const state = newTracks.get(id);
          if (!state) continue;

          const tags = getTrackTags(state);
          const filePath = state.track.filePath;
          const parts = filePath.split("/");
          const fullFilename = parts[parts.length - 1];
          const dotIdx = fullFilename.lastIndexOf(".");
          const filename =
            dotIdx > 0 ? fullFilename.slice(0, dotIdx) : fullFilename;
          const ext = dotIdx > 0 ? fullFilename.slice(dotIdx + 1) : "";

          try {
            const context: Record<string, string> = {
              filename,
              ext,
              filepath: filePath,
              title: tags.TITLE ?? "",
              artist: tags.ARTIST ?? "",
              albumartist: tags.ALBUMARTIST ?? "",
              album: tags.ALBUM ?? "",
              genre: tags.GENRE ?? "",
              year: tags.YEAR ?? "",
              tracknumber: tags.TRACKNUMBER ?? "",
              tracktotal: tags.TRACKTOTAL ?? "",
              discnumber: tags.DISCNUMBER ?? "",
              disctotal: tags.DISCTOTAL ?? "",
              comment: tags.COMMENT ?? "",
              composer: tags.COMPOSER ?? "",
            };

            const fn = new Function(...Object.keys(context), code);
            const result = fn(...Object.values(context));

            if (typeof result === "string" && result.trim()) {
              newTracks.set(id, {
                ...state,
                computedPath: result,
              });
            }
          } catch (e) {
            console.error(`Script error on ${id}:`, e);
          }
        }
        return newTracks;
      });

      toast.success(
        `Applied rename script to ${targetIds.length} track${targetIds.length !== 1 ? "s" : ""}`,
      );
    }
  }

  return (
    <div
      className="flex flex-col h-full relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        data-testid="tagger-upload-input"
        className="hidden"
        accept="audio/*"
        multiple
        onChange={handleFileInputChange}
      />

      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center border-2 border-dashed border-primary rounded-lg">
          <div className="text-center">
            <Upload className="w-16 h-16 mx-auto mb-4 text-primary" />
            <p className="text-xl font-semibold">Drop audio files here</p>
            <p className="text-sm text-muted-foreground mt-1">
              Files will be uploaded and added to the tagger
            </p>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between p-4 border-b border-border/40">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Tagger</h1>
          {isLoadingTracks && (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          )}
        </div>

        <div className="flex items-center gap-2">
          <FilesDropdown
            onUpload={() => fileInputRef.current?.click()}
            onAddFromLibrary={() => setIsAddFromLibraryOpen(true)}
            onFindMisnamed={() => setIsFindMisnamedOpen(true)}
            onRemoveSelected={handleRemoveSelected}
            onClearAll={() => setIsClearConfirmOpen(true)}
            isUploading={isUploading}
            hasSelectedTracks={selectedCount > 0}
            hasAnyTracks={trackCount > 0}
          />
          <ColumnSelector />
          <TaggerOptionsDialog />

          <Button
            variant="outline"
            size="sm"
            onClick={() => setDetailsPanelOpen(!detailsPanelOpen)}
            title={detailsPanelOpen ? "Hide details" : "Show details"}
          >
            {detailsPanelOpen ? (
              <>
                <PanelRightClose className="w-4 h-4 mr-2 max-sm:mr-0" />
                <span className="max-sm:hidden">Details</span>
              </>
            ) : (
              <>
                <PanelRightOpen className="w-4 h-4 mr-2 max-sm:mr-0" />
                <span className="max-sm:hidden">Details</span>
              </>
            )}
          </Button>

          <Button
            size="sm"
            disabled={!hasChanges || isSaving}
            onClick={() => {
              // Run rename script on all tracks first to ensure paths are up-to-date
              runOnAllTracks();
              // Clear specific track IDs to save all dirty tracks
              setTrackIdsToSave([]);
              setIsSaveConfirmOpen(true);
            }}
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 min-h-0">
        {/* Grid Section - hidden on mobile when details panel is open */}
        <div
          className={`flex-1 min-w-0 ${detailsPanelOpen ? "max-md:hidden" : ""}`}
        >
          {!taggerStateLoaded ||
          isLoadingTracks ||
          (trackCount === 0 && session.tracks.length > 0) ? (
            // Show skeleton while loading tagger state or tracks
            <div className="h-full p-4 space-y-2">
              <div className="flex items-center gap-4 pb-2 border-b border-border/40">
                <div className="h-4 w-20 bg-muted animate-pulse rounded" />
                <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                <div className="h-4 w-28 bg-muted animate-pulse rounded" />
              </div>
              {Array.from({
                length: Math.max(Math.min(session.tracks.length || 8, 12), 4),
              }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 py-1">
                  <div className="h-4 w-4 bg-muted animate-pulse rounded" />
                  <div className="h-4 w-48 bg-muted animate-pulse rounded" />
                  <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                  <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                  <div className="h-4 w-28 bg-muted animate-pulse rounded" />
                </div>
              ))}
            </div>
          ) : trackCount === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Upload className="w-12 h-12 mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">No tracks loaded</p>
              <p className="text-sm mb-4">
                Drop audio files here, or add tracks from your library.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Files
                </Button>
                <Button
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsAddFromLibraryOpen(true);
                  }}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add from Library
                </Button>
              </div>
            </div>
          ) : (
            <TaggerGrid
              visibleColumns={session.visibleColumns}
              onColumnsReorder={(cols) =>
                setSession((s) => ({ ...s, visibleColumns: cols }))
              }
              onRemoveTracks={handleRemoveTracks}
              onRevertTracks={handleRevertTracks}
              onSaveTracks={handleSaveTracks}
              onOpenOneOffScript={() => setIsOneOffScriptOpen(true)}
            />
          )}
        </div>

        {/* Details Panel - full width on mobile, resizable on desktop */}
        {trackCount > 0 && detailsPanelOpen && (
          <div
            className="w-full md:border-l border-border/40 overflow-y-auto relative shrink-0 hidden md:block"
            style={{ width: detailsPanelWidth }}
          >
            {/* Resize handle */}
            <div
              className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-primary/30 transition-colors z-10"
              onMouseDown={handleResizeStart}
            />
            <TrackDetailsPanel panelWidth={detailsPanelWidth} />
          </div>
        )}
        {/* Details Panel - full width on mobile */}
        {trackCount > 0 && detailsPanelOpen && (
          <div className="w-full border-t border-border/40 overflow-y-auto md:hidden">
            <TrackDetailsPanel />
          </div>
        )}
      </div>

      {/* Footer with stats - provides space so scrollbar isn't obscured by waveform */}
      {trackCount > 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-border/40 bg-background text-sm text-muted-foreground">
          <div className="flex items-center gap-4">
            <span>
              {trackCount} track{trackCount !== 1 ? "s" : ""}
            </span>
            {selectedCount > 0 && (
              <span className="text-primary">{selectedCount} selected</span>
            )}
            {hasChanges && (
              <span className="text-primary">
                {dirtyTrackIds.length} modified
              </span>
            )}
          </div>
          {/* Right side - focused track info */}
          {focusedTrack && (
            <div className="flex items-center gap-4">
              <span>
                {(Number(focusedTrack.track.fileSize) / 1024 / 1024).toFixed(1)}{" "}
                MB
              </span>
              <span>{focusedTrack.track.fileFormat.toUpperCase()}</span>
              <span>
                {Math.floor(
                  Number(focusedTrack.track.durationMs ?? 0) / 1000 / 60,
                )}
                :
                {String(
                  Math.floor(
                    (Number(focusedTrack.track.durationMs ?? 0) / 1000) % 60,
                  ),
                ).padStart(2, "0")}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Dialogs */}
      <AddFromLibraryDialog
        open={isAddFromLibraryOpen}
        onOpenChange={setIsAddFromLibraryOpen}
      />

      <FindMisnamedDialog
        open={isFindMisnamedOpen}
        onOpenChange={setIsFindMisnamedOpen}
      />

      {/* Clear confirmation */}
      <AlertDialog
        open={isClearConfirmOpen}
        onOpenChange={(open) => {
          setIsClearConfirmOpen(open);
          if (open) {
            // Reset delete from staging when opening dialog
            setDeleteFromStaging(true);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all tracks?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This will remove all {trackCount} track
                  {trackCount !== 1 ? "s" : ""} from the tagger.
                  {hasChanges && " Any unsaved changes will be lost."}
                </p>
                {hasStagedTracks && (
                  <div className="flex items-center space-x-2 p-3 rounded-md bg-muted/50">
                    <Checkbox
                      id="delete-staged-clear"
                      checked={deleteFromStaging}
                      onCheckedChange={(checked: boolean) =>
                        setDeleteFromStaging(checked)
                      }
                    />
                    <label
                      htmlFor="delete-staged-clear"
                      className="text-sm font-medium leading-none cursor-pointer"
                    >
                      Also delete uploaded files from staging folder
                    </label>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={handleClearAll}>
              Clear All
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Save confirmation */}
      <SaveConfirmationDialog
        open={isSaveConfirmOpen}
        onOpenChange={(open) => {
          setIsSaveConfirmOpen(open);
          if (!open) setTrackIdsToSave([]); // Clear on close
        }}
        dirtyTrackIds={
          trackIdsToSave.length > 0 ? trackIdsToSave : dirtyTrackIds
        }
        onSave={handleSave}
        isSaving={isSaving}
        saveProgress={saveProgress}
      />

      {/* Upload progress dialog */}
      <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
        <DialogContent className="sm:max-w-lg md:max-w-xl lg:max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Uploading Files...
                </>
              ) : uploadingFiles.every((f) => f.status === "done") ? (
                "Upload Complete"
              ) : (
                "Upload Failed"
              )}
            </DialogTitle>
            <DialogDescription className="sr-only">
              File upload progress
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 flex-1 min-h-0 overflow-hidden flex flex-col">
            {/* Progress bar */}
            <Progress
              className="shrink-0"
              value={
                (uploadingFiles.filter((f) => f.status === "done").length /
                  uploadingFiles.length) *
                100
              }
            />

            {/* File list */}
            <div className="space-y-2 flex-1 overflow-auto min-h-0">
              {uploadingFiles.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 p-2 rounded bg-muted/50 min-w-0"
                >
                  <span className="text-sm truncate flex-1 min-w-0">
                    {f.name}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                    {(f.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                  {f.status === "uploading" && (
                    <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                  )}
                  {f.status === "done" && (
                    <span className="text-xs text-green-500 shrink-0">✓</span>
                  )}
                  {f.status === "error" && (
                    <span className="text-xs text-red-500 shrink-0">✗</span>
                  )}
                </div>
              ))}
            </div>

            {/* Close button for errors */}
            {!isUploading &&
              uploadingFiles.some((f) => f.status === "error") && (
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsUploadDialogOpen(false);
                      setUploadingFiles([]);
                    }}
                  >
                    Close
                  </Button>
                </div>
              )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Remove confirmation dialog */}
      <AlertDialog
        open={isRemoveConfirmOpen}
        onOpenChange={setIsRemoveConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Tracks</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Are you sure you want to remove {pendingRemoveIds.length}{" "}
                  track{pendingRemoveIds.length !== 1 ? "s" : ""} from the
                  tagger?
                </p>
                {pendingRemoveIds.some(
                  (id) => tracks.get(id)?.track.isStaged,
                ) && (
                  <div className="flex items-center space-x-2 p-3 rounded-md bg-muted/50">
                    <Checkbox
                      id="delete-staged"
                      checked={deleteFromStaging}
                      onCheckedChange={(checked: boolean) =>
                        setDeleteFromStaging(checked)
                      }
                    />
                    <label
                      htmlFor="delete-staged"
                      className="text-sm font-medium leading-none cursor-pointer"
                    >
                      Also delete uploaded files from staging folder
                    </label>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingRemoveIds([])}>
              Cancel
            </AlertDialogCancel>
            <Button variant="destructive" onClick={confirmRemoveTracks}>
              Remove
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* One-off script dialog */}
      <ScriptEditorDialog
        open={isOneOffScriptOpen}
        onOpenChange={setIsOneOffScriptOpen}
        scriptType="tags"
        oneOffMode={true}
        onRunOnce={handleRunOneOffScript}
      />
    </div>
  );
}
