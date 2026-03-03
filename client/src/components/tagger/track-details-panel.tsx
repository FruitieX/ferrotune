"use client";

import { useRef, useState, useEffect } from "react";
import { useAtom, useAtomValue } from "jotai";
import Image from "next/image";
import {
  Music,
  Image as ImageIcon,
  X,
  AlertCircle,
  Upload,
  RotateCcw,
  Trash2,
  Plus,
  ChevronDown,
  Copy,
  ClipboardPaste,
  Play,
  Pause,
  Volume2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getClient } from "@/lib/api/client";
import { useRenameScript } from "@/lib/hooks/use-rename-script";
import { usePreviewAudio } from "@/lib/hooks/use-preview-audio";
import {
  taggerTracksAtom,
  taggerSelectedIdsAtom,
  taggerFocusedRowIdAtom,
  taggerSessionAtom,
  TaggerTrackState,
  getTrackTags,
} from "@/lib/store/tagger";

interface TagInfo {
  value: string;
  mixed: boolean;
  originalValue: string;
  edited: boolean;
}

// Common tags that users might want to add
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
  "COMPOSER",
  "CONDUCTOR",
  "PERFORMER",
  "LYRICIST",
  "COMMENT",
  "COPYRIGHT",
  "LABEL",
  "ISRC",
  "BPM",
  "MOOD",
  "COMPILATION",
];

interface TrackDetailsPanelProps {
  /** Width of the panel in pixels, used to scale cover art */
  panelWidth?: number;
}

export function TrackDetailsPanel({ panelWidth }: TrackDetailsPanelProps) {
  const [tracks, setTracks] = useAtom(taggerTracksAtom);
  const [selectedIds] = useAtom(taggerSelectedIdsAtom);
  const focusedRowId = useAtomValue(taggerFocusedRowIdAtom);
  const session = useAtomValue(taggerSessionAtom);
  const { runOnTracks } = useRenameScript();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const volumeContainerRef = useRef<HTMLDivElement>(null);
  const [coverArtModalOpen, setCoverArtModalOpen] = useState(false);
  const [coverArtModalType, setCoverArtModalType] = useState<
    "original" | "modified"
  >("original");
  const [newTagKey, setNewTagKey] = useState("");

  // Preview audio for track playback
  const preview = usePreviewAudio();

  // Handle scroll wheel to adjust volume on volume container
  useEffect(() => {
    const container = volumeContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 5 : -5;
      const newVolume = Math.max(0, Math.min(100, preview.volume + delta));
      preview.setVolume(newVolume);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [preview.volume, preview.setVolume, preview]);

  // Keep a ref to the stop function to avoid stale closures
  const previewStopRef = useRef(preview.stop);
  useEffect(() => {
    previewStopRef.current = preview.stop;
  }, [preview.stop]);

  // Stop preview when track selection changes
  useEffect(() => {
    previewStopRef.current();
  }, [focusedRowId, selectedIds]);

  // Get selected track(s) - prioritize checkbox selections, then use focused row
  let selectedTracks: TaggerTrackState[] = Array.from(selectedIds)
    .map((id) => tracks.get(id))
    .filter((t): t is TaggerTrackState => t !== undefined);

  // If no checkbox selections but we have a focused row, use that
  if (selectedTracks.length === 0 && focusedRowId) {
    const focusedTrack = tracks.get(focusedRowId);
    if (focusedTrack) {
      selectedTracks = [focusedTrack];
    }
  }

  // Get the track IDs we're actually working with (for editing)
  const editingIds =
    selectedIds.size > 0
      ? selectedIds
      : focusedRowId
        ? new Set([focusedRowId])
        : new Set<string>();

  if (selectedTracks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4">
        <Music className="w-12 h-12 mb-2 opacity-50" />
        <p className="text-sm text-center">
          Select a track to view and edit details
        </p>
      </div>
    );
  }

  const singleTrack = selectedTracks.length === 1 ? selectedTracks[0] : null;

  // Collect tags with mixed value detection
  const allTags: Record<string, TagInfo> = {};

  if (singleTrack) {
    const currentTags = getTrackTags(singleTrack);
    const originalTags: Record<string, string> = {};
    for (const tag of singleTrack.track.tags) {
      originalTags[tag.key] = tag.value;
    }

    for (const [key, value] of Object.entries(currentTags)) {
      allTags[key] = {
        value,
        mixed: false,
        originalValue: originalTags[key] ?? "",
        edited: key in singleTrack.editedTags,
      };
    }
  } else {
    // Multiple tracks - find common tags and mark differences
    const firstTags = getTrackTags(selectedTracks[0]);
    for (const [key, value] of Object.entries(firstTags)) {
      let mixed = false;
      for (let i = 1; i < selectedTracks.length; i++) {
        const otherTags = getTrackTags(selectedTracks[i]);
        if (otherTags[key] !== value) {
          mixed = true;
          break;
        }
      }
      allTags[key] = {
        value: mixed ? "" : value,
        mixed,
        originalValue: "",
        edited: false,
      };
    }

    // Check for keys in other tracks not in first
    for (let i = 1; i < selectedTracks.length; i++) {
      const otherTags = getTrackTags(selectedTracks[i]);
      for (const key of Object.keys(otherTags)) {
        if (!(key in allTags)) {
          allTags[key] = {
            value: "",
            mixed: true,
            originalValue: "",
            edited: false,
          };
        }
      }
    }
  }

  // Sort tags - common ones first
  const sortedTagKeys = Object.keys(allTags).sort((a, b) => {
    const priority = [
      "TITLE",
      "ARTIST",
      "ALBUM",
      "ALBUMARTIST",
      "TRACKNUMBER",
      "DISCNUMBER",
      "YEAR",
      "GENRE",
    ];
    const aIdx = priority.indexOf(a);
    const bIdx = priority.indexOf(b);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return a.localeCompare(b);
  });

  // Get tags available for adding (not already present)
  const existingTagKeys = new Set(sortedTagKeys);
  const availableTagsToAdd = COMMON_TAGS.filter(
    (tag) => !existingTagKeys.has(tag),
  );

  // Handle tag value change (works for single or multiple tracks)
  function handleTagChange(key: string, newValue: string) {
    const newTracks = new Map(tracks);

    for (const id of editingIds) {
      const state = newTracks.get(id);
      if (!state) continue;

      // Find original value for this track
      const originalTag = state.track.tags.find((t) => t.key === key);
      const originalValue = originalTag?.value ?? "";

      // Update edited tags - always set value, even if empty
      // (deletion is now explicit via delete button)
      const updatedEditedTags = { ...state.editedTags };
      if (newValue !== originalValue) {
        updatedEditedTags[key] = newValue;
      } else {
        delete updatedEditedTags[key];
      }

      newTracks.set(id, {
        ...state,
        editedTags: updatedEditedTags,
      });
    }

    setTracks(newTracks);
    // Re-run rename script since tags changed
    runOnTracks(Array.from(editingIds));
  }

  // Handle reverting a single tag to its original value
  function handleRevertTag(key: string) {
    const newTracks = new Map(tracks);

    for (const id of editingIds) {
      const state = newTracks.get(id);
      if (!state) continue;

      const updatedEditedTags = { ...state.editedTags };
      delete updatedEditedTags[key];

      newTracks.set(id, {
        ...state,
        editedTags: updatedEditedTags,
      });
    }

    setTracks(newTracks);
    // Re-run rename script since tags changed
    runOnTracks(Array.from(editingIds));
  }

  // Handle deleting a tag (mark it for deletion)
  function handleDeleteTag(key: string) {
    const newTracks = new Map(tracks);

    for (const id of editingIds) {
      const state = newTracks.get(id);
      if (!state) continue;

      const originalTag = state.track.tags.find((t) => t.key === key);
      const updatedEditedTags = { ...state.editedTags };

      if (originalTag) {
        // If orig existed, mark as deleted with empty value
        // The save logic should interpret this as "delete this tag"
        updatedEditedTags[key] = "";
      } else {
        // Tag was only in editedTags, just remove it
        delete updatedEditedTags[key];
      }

      newTracks.set(id, {
        ...state,
        editedTags: updatedEditedTags,
      });
    }

    setTracks(newTracks);
    // Re-run rename script since tags changed
    runOnTracks(Array.from(editingIds));
  }

  // Handle adding a new tag
  function handleAddTag(key: string) {
    const normalizedKey = key.toUpperCase().trim();
    if (!normalizedKey || existingTagKeys.has(normalizedKey)) return;

    const newTracks = new Map(tracks);

    for (const id of editingIds) {
      const state = newTracks.get(id);
      if (!state) continue;

      const updatedEditedTags = { ...state.editedTags };
      updatedEditedTags[normalizedKey] = "";

      newTracks.set(id, {
        ...state,
        editedTags: updatedEditedTags,
      });
    }

    setTracks(newTracks);
    // Re-run rename script since tags changed
    runOnTracks(Array.from(editingIds));
    setNewTagKey("");
  }

  // Handle cover art replacement
  async function handleCoverArtReplace(file: File) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      const newTracks = new Map(tracks);

      // Upload cover art for each selected track
      const client = getClient();
      for (const id of editingIds) {
        const state = newTracks.get(id);
        if (!state) continue;

        // Upload to server
        if (client) {
          try {
            await client.uploadTaggerCoverArt(id, file);
          } catch (err) {
            console.error("Failed to upload cover art:", err);
            toast.error("Failed to upload cover art");
            return; // Abort on first failure
          }
        }

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
    };
    reader.readAsDataURL(file);
  }

  // Handle cover art removal
  async function handleCoverArtRemove() {
    const newTracks = new Map(tracks);
    const client = getClient();

    for (const id of editingIds) {
      const state = newTracks.get(id);
      if (!state) continue;

      // Delete from server
      if (client) {
        try {
          await client.deleteTaggerCoverArt(id);
        } catch (err) {
          console.error("Failed to delete cover art:", err);
          // Continue anyway - local state will be updated
        }
      }

      newTracks.set(id, {
        ...state,
        coverArt: {
          changed: false,
          removed: true,
        },
      });
    }

    setTracks(newTracks);
  }

  // Handle cover art revert (reset to original)
  async function handleCoverArtRevert() {
    const newTracks = new Map(tracks);
    const client = getClient();

    for (const id of editingIds) {
      const state = newTracks.get(id);
      if (!state) continue;

      // If there was uploaded cover art, delete it from server
      if (state.coverArt?.changed && client) {
        try {
          await client.deleteTaggerCoverArt(id);
        } catch (err) {
          console.error("Failed to delete staged cover art:", err);
        }
      }

      newTracks.set(id, {
        ...state,
        coverArt: null, // Reset to original (no changes)
      });
    }

    setTracks(newTracks);
  }

  // Handle paste for cover art (from clipboard)
  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          handleCoverArtReplace(file);
        }
        break;
      }
    }
  }

  // Handle copy cover art to clipboard
  async function handleCoverArtCopy() {
    if (!singleTrack) return;

    // Helper to convert a blob/dataUrl to PNG and copy to clipboard
    async function copyImageToClipboard(imageSrc: string) {
      return new Promise<void>((resolve, reject) => {
        const img = document.createElement("img");
        img.crossOrigin = "anonymous";
        img.onload = async () => {
          try {
            // Draw image to canvas to convert to PNG
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              reject(new Error("Could not get canvas context"));
              return;
            }
            ctx.drawImage(img, 0, 0);

            // Convert to PNG blob
            canvas.toBlob(async (blob) => {
              if (!blob) {
                reject(new Error("Could not convert to blob"));
                return;
              }
              try {
                await navigator.clipboard.write([
                  new ClipboardItem({ "image/png": blob }),
                ]);
                resolve();
              } catch (err) {
                reject(err);
              }
            }, "image/png");
          } catch (err) {
            reject(err);
          }
        };
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = imageSrc;
      });
    }

    // If there's a modified cover art with dataUrl, use that
    if (singleTrack.coverArt?.dataUrl) {
      try {
        await copyImageToClipboard(singleTrack.coverArt.dataUrl);
        toast.success("Copied cover art to clipboard");
      } catch (err) {
        console.debug("Failed to copy cover art:", err);
      }
      return;
    }

    // Otherwise, copy the original cover art from the server
    const client = getClient();
    if (!client || !hasCoverArt || isStaged) return;

    try {
      const url = client.getCoverArtUrl(
        songId!.startsWith("so-") ? songId! : `so-${songId}`,
        "large",
      );
      await copyImageToClipboard(url);
      toast.success("Copied cover art to clipboard");
    } catch (err) {
      console.debug("Failed to copy cover art:", err);
    }
  }

  // Handle paste from clipboard (button click)
  async function handlePasteFromClipboard() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        // Find first image type in the clipboard item
        const imageType = item.types.find(
          (type) =>
            type.startsWith("image/") ||
            type === "image/png" ||
            type === "image/jpeg",
        );
        if (imageType) {
          const blob = await item.getType(imageType);
          const file = new File([blob], "pasted-image.png", {
            type: imageType,
          });
          handleCoverArtReplace(file);
          return;
        }
      }
    } catch (err) {
      // Clipboard read might fail due to permissions or empty clipboard
      console.debug("Clipboard read failed:", err);
    }
  }

  // Get cover art info - use song ID for library tracks, coverArtId (hash) isn't directly usable
  // Cover art endpoint expects entity IDs like so-{songId}, not hashes
  const songId = singleTrack?.track.id;
  const isStaged = singleTrack?.track.isStaged;
  const hasCoverArt = singleTrack?.track.coverArtId != null;
  const coverArtState = singleTrack?.coverArt;
  const multipleCoverArts =
    !singleTrack &&
    new Set(selectedTracks.map((t) => t.track.coverArtId ?? "none")).size > 1;

  // Check if any selected track has cover art changes
  const hasCoverArtChanges = selectedTracks.some(
    (t) => t.coverArt?.changed || t.coverArt?.removed,
  );

  // Check if any selected track has any changes (tags, path, cover art, or replacement audio)
  const selectedTracksHaveChanges = selectedTracks.some(
    (t) =>
      Object.keys(t.editedTags).length > 0 ||
      t.computedPath !== null ||
      t.coverArt?.changed ||
      t.coverArt?.removed ||
      t.hasReplacementAudio,
  );

  // Discard all changes in selected tracks
  async function handleDiscardAllChanges() {
    const client = getClient();
    const newTracks = new Map(tracks);

    for (const id of editingIds) {
      const state = newTracks.get(id);
      if (state) {
        // If there's replacement audio staged, delete it from server
        if (state.hasReplacementAudio && client) {
          try {
            await client.deleteTaggerReplacementAudio(id);
          } catch (err) {
            console.error("Failed to delete staged replacement audio:", err);
          }
        }

        newTracks.set(id, {
          ...state,
          editedTags: {},
          computedPath: null,
          coverArt: null,
          hasReplacementAudio: false,
          replacementAudioFilename: undefined,
          replacementAudioOriginalName: undefined,
        });
      }
    }
    setTracks(newTracks);
  }

  // Determine what to display for cover art (considers pending modifications)
  const getCoverArtDisplay = () => {
    if (coverArtState?.removed) {
      return { type: "removed" as const };
    }
    if (coverArtState?.dataUrl) {
      return { type: "preview" as const, src: coverArtState.dataUrl };
    }
    if (multipleCoverArts) {
      return { type: "mixed" as const };
    }
    // For library tracks with cover art, use song ID
    // Song IDs already have the so- prefix, don't add it again
    if (songId && hasCoverArt && !isStaged) {
      const coverArtIdForUrl = songId.startsWith("so-")
        ? songId
        : `so-${songId}`;
      // Use the cover art hash as cache buster - when it changes, URL changes
      const cacheBuster = singleTrack?.track.coverArtId ?? undefined;
      const url = getClient()?.getCoverArtUrl(
        coverArtIdForUrl,
        "large",
        cacheBuster,
      );
      if (url) {
        return {
          type: "existing" as const,
          src: url,
          songId: songId,
        };
      }
    }
    // For staged tracks, try to get embedded cover art from the audio file
    if (songId && isStaged) {
      const url = getClient()?.getStagedFileCoverUrl(songId);
      if (url) {
        return {
          type: "existing" as const,
          src: url,
          songId: songId,
        };
      }
    }
    return { type: "none" as const };
  };

  const coverArtDisplay = getCoverArtDisplay();

  // Get original cover art URL (ignores pending modifications - for "Original" column)
  const getOriginalCoverArtUrl = (): string | null => {
    // For library tracks with cover art
    if (songId && hasCoverArt && !isStaged) {
      const coverArtIdForUrl = songId.startsWith("so-")
        ? songId
        : `so-${songId}`;
      const cacheBuster = singleTrack?.track.coverArtId ?? undefined;
      return (
        getClient()?.getCoverArtUrl(coverArtIdForUrl, "large", cacheBuster) ??
        null
      );
    }
    // For staged tracks
    if (songId && isStaged) {
      return getClient()?.getStagedFileCoverUrl(songId) ?? null;
    }
    return null;
  };

  const originalCoverArtUrl = getOriginalCoverArtUrl();

  // Compact mode for narrow panels (below 400px)
  const isCompactMode = panelWidth !== undefined && panelWidth < 400;

  // Calculate cover art size based on panel width
  // Formula: available width = panel - label (100px) - padding (32px) - actions (56px) - gaps
  // Each cover gets half of that. Max 160px, min 80px.
  // In compact mode, use full width with smaller size
  const coverArtSize = isCompactMode
    ? Math.min(100, Math.max(60, Math.floor((panelWidth - 80) / 2)))
    : panelWidth
      ? Math.min(160, Math.max(80, Math.floor((panelWidth - 220) / 2)))
      : 160;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Music className="w-5 h-5 text-muted-foreground" />
          <span className="font-medium truncate">
            {singleTrack
              ? singleTrack.track.filePath.split("/").pop()
              : `${selectedTracks.length} tracks selected`}
          </span>
        </div>
        {singleTrack &&
          (() => {
            const musicFolderPath = singleTrack.track.musicFolderPath;
            const showPrefix =
              session.showLibraryPrefix &&
              musicFolderPath &&
              !singleTrack.track.isStaged;
            const originalPath = showPrefix
              ? `${musicFolderPath}/${singleTrack.track.filePath}`
              : singleTrack.track.filePath;
            const computedPath =
              singleTrack.computedPath && showPrefix
                ? `${musicFolderPath}/${singleTrack.computedPath}`
                : singleTrack.computedPath;

            return (
              <div className="mt-1 space-y-0.5">
                {/* Original path */}
                <p
                  className="text-xs text-muted-foreground truncate"
                  title={originalPath}
                >
                  {originalPath}
                </p>
                {/* New path (if different) */}
                {computedPath && computedPath !== originalPath && (
                  <p
                    className="text-xs text-primary font-medium truncate"
                    title={computedPath}
                  >
                    → {computedPath}
                  </p>
                )}
                {/* Replacement audio indicator */}
                {singleTrack.hasReplacementAudio && (
                  <p className="text-xs text-blue-500 font-medium">
                    🔊 Audio replacement staged:{" "}
                    {singleTrack.replacementAudioOriginalName}
                  </p>
                )}
              </div>
            );
          })()}
      </div>

      {/* Cover Art - side by side layout matching tag list (or compact vertical layout) */}
      <div className="p-4 border-b border-border/40">
        {/* Header row matching tag list - hide in compact mode */}
        {singleTrack && !isCompactMode && (
          <div className="flex items-center text-xs text-muted-foreground pb-2 mb-2 border-b border-border/30">
            <span className="w-[100px] shrink-0">Cover Art</span>
            <span className="flex-1 min-w-0 px-1">Original</span>
            <span className="flex-1 min-w-0 px-1">Modified</span>
            <span className="w-14 shrink-0" />
          </div>
        )}

        {/* Compact mode: show "Cover Art" heading above */}
        {singleTrack && isCompactMode && (
          <div className="text-xs text-muted-foreground mb-2">Cover Art</div>
        )}

        <div
          className={
            isCompactMode ? "flex flex-col gap-2" : "flex items-start gap-1"
          }
        >
          {/* Label column - hide in compact mode */}
          {!isCompactMode && (
            <div className="w-[100px] shrink-0 pt-2">
              {!singleTrack && (
                <span className="text-xs text-muted-foreground">Cover Art</span>
              )}
            </div>
          )}

          {singleTrack ? (
            <div
              className={isCompactMode ? "flex items-start gap-2" : "contents"}
            >
              {/* Original cover art */}
              <div
                className={isCompactMode ? "flex-1" : "flex-1 min-w-0 px-1"}
                onPaste={handlePaste}
                tabIndex={0}
              >
                {/* Label for compact mode */}
                {isCompactMode && (
                  <div className="text-xs text-muted-foreground mb-1">
                    Original
                  </div>
                )}
                <div
                  className={`bg-muted/30 rounded flex items-center justify-center relative shrink-0 overflow-hidden ${
                    originalCoverArtUrl
                      ? "cursor-pointer hover:ring-2 hover:ring-primary/50"
                      : ""
                  }`}
                  style={{ width: coverArtSize, height: coverArtSize }}
                  onClick={() => {
                    if (originalCoverArtUrl) {
                      setCoverArtModalType("original");
                      setCoverArtModalOpen(true);
                    }
                  }}
                >
                  {originalCoverArtUrl ? (
                    <Image
                      src={originalCoverArtUrl}
                      alt="Original cover art"
                      className="w-full h-full object-cover"
                      width={coverArtSize}
                      height={coverArtSize}
                      unoptimized
                    />
                  ) : (
                    <ImageIcon
                      className={
                        isCompactMode
                          ? "w-8 h-8 text-muted-foreground/50"
                          : "w-12 h-12 text-muted-foreground/50"
                      }
                    />
                  )}
                </div>
              </div>

              {/* Modified cover art */}
              <div className={isCompactMode ? "flex-1" : "flex-1 min-w-0 px-1"}>
                {/* Label for compact mode */}
                {isCompactMode && (
                  <div className="text-xs text-muted-foreground mb-1">
                    Modified
                  </div>
                )}
                <div
                  className={`rounded flex items-center justify-center relative shrink-0 overflow-hidden ${
                    hasCoverArtChanges
                      ? "border-2 border-primary/50 bg-primary/5"
                      : "bg-muted/30"
                  } ${
                    coverArtDisplay.type === "preview" ||
                    coverArtDisplay.type === "existing"
                      ? "cursor-pointer hover:ring-2 hover:ring-primary/50"
                      : ""
                  }`}
                  style={{ width: coverArtSize, height: coverArtSize }}
                  onClick={() => {
                    if (
                      coverArtDisplay.type === "preview" ||
                      coverArtDisplay.type === "existing"
                    ) {
                      setCoverArtModalType("modified");
                      setCoverArtModalOpen(true);
                    }
                  }}
                  onPaste={handlePaste}
                  tabIndex={0}
                >
                  {coverArtDisplay.type === "removed" ? (
                    <div className="flex flex-col items-center text-muted-foreground">
                      <X
                        className={
                          isCompactMode
                            ? "w-6 h-6 mb-1 text-red-500"
                            : "w-8 h-8 mb-1 text-red-500"
                        }
                      />
                      <span className={isCompactMode ? "text-xs" : "text-sm"}>
                        (deleted)
                      </span>
                    </div>
                  ) : coverArtDisplay.type === "preview" ? (
                    <Image
                      src={coverArtDisplay.src}
                      alt="Modified cover art"
                      className="w-full h-full object-cover"
                      width={coverArtSize}
                      height={coverArtSize}
                      unoptimized
                    />
                  ) : coverArtDisplay.type === "existing" &&
                    coverArtDisplay.src ? (
                    <Image
                      src={coverArtDisplay.src}
                      alt="Cover art"
                      className="w-full h-full object-cover"
                      width={coverArtSize}
                      height={coverArtSize}
                      unoptimized
                    />
                  ) : (
                    <ImageIcon
                      className={
                        isCompactMode
                          ? "w-8 h-8 text-muted-foreground/50"
                          : "w-12 h-12 text-muted-foreground/50"
                      }
                    />
                  )}
                </div>
              </div>

              {/* Action buttons - vertical column in normal mode, horizontal row below in compact mode */}
              <div
                className={
                  isCompactMode
                    ? "flex flex-row items-center justify-center gap-1 mt-2 w-full"
                    : "w-14 shrink-0 flex flex-col items-center gap-0.5 justify-end pt-2"
                }
              >
                {hasCoverArtChanges && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={handleCoverArtRevert}
                    title="Revert to original"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </Button>
                )}
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleCoverArtReplace(file);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => fileInputRef.current?.click()}
                  title="Replace cover art"
                >
                  <Upload className="w-3 h-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={handleCoverArtCopy}
                  disabled={
                    coverArtDisplay.type === "none" ||
                    coverArtDisplay.type === "removed"
                  }
                  title="Copy cover art"
                >
                  <Copy className="w-3 h-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={handlePasteFromClipboard}
                  title="Paste cover art"
                >
                  <ClipboardPaste className="w-3 h-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-red-500"
                  onClick={handleCoverArtRemove}
                  disabled={
                    coverArtDisplay.type === "none" ||
                    coverArtDisplay.type === "removed"
                  }
                  title="Delete cover art"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ) : (
            /* Multiple tracks selected */
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <div
                  className={`w-20 h-20 bg-muted rounded flex items-center justify-center relative shrink-0 overflow-hidden`}
                >
                  {multipleCoverArts ? (
                    <div className="flex flex-col items-center text-muted-foreground">
                      <AlertCircle className="w-6 h-6 mb-1" />
                      <span className="text-xs">Mixed</span>
                    </div>
                  ) : (
                    <ImageIcon className="w-8 h-8 text-muted-foreground/50" />
                  )}
                </div>
                {/* Action buttons - same style as single selection */}
                <div className="flex flex-col items-center gap-0.5 justify-end pt-2">
                  {hasCoverArtChanges && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={handleCoverArtRevert}
                      title="Revert all to original"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </Button>
                  )}
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleCoverArtReplace(file);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => fileInputRef.current?.click()}
                    title="Replace cover art (batch)"
                  >
                    <Upload className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={handlePasteFromClipboard}
                    title="Paste cover art (batch)"
                  >
                    <ClipboardPaste className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-red-500"
                    onClick={handleCoverArtRemove}
                    title="Delete cover art (batch)"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tags List - now wider with original column (or compact vertical layout) */}
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-2">
          {/* Header row - hide in compact mode */}
          {singleTrack && sortedTagKeys.length > 0 && !isCompactMode && (
            <div className="flex items-center text-xs text-muted-foreground pb-1 border-b border-border/30">
              <span className="w-[100px] shrink-0">Tag</span>
              <span className="flex-1 min-w-0 px-1">Original</span>
              <span className="flex-1 min-w-0 px-1">Modified</span>
              <span className="w-14 shrink-0" />
            </div>
          )}

          {sortedTagKeys.map((key) => {
            const tag = allTags[key];
            const isDeleted =
              tag.edited &&
              tag.value === "" &&
              tag.originalValue !== "" &&
              singleTrack;

            return (
              <div
                key={key}
                className={
                  isCompactMode
                    ? "space-y-1 pb-2 border-b border-border/20"
                    : "flex items-center gap-1"
                }
              >
                {/* Tag name */}
                <Label
                  className={
                    isCompactMode
                      ? `text-xs ${tag.edited ? "text-primary font-medium" : "text-muted-foreground"}`
                      : `w-[100px] shrink-0 text-xs truncate ${tag.edited ? "text-primary font-medium" : "text-muted-foreground"}`
                  }
                  title={key}
                >
                  {key}
                </Label>

                {singleTrack ? (
                  isCompactMode ? (
                    // Compact mode: vertical layout with labeled sections
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        {/* Original value */}
                        <div
                          className="flex-1 min-w-0 text-xs text-muted-foreground bg-muted/30 px-2 py-1.5 rounded truncate"
                          title={tag.originalValue || "(empty)"}
                        >
                          {tag.originalValue || (
                            <span className="italic">(empty)</span>
                          )}
                        </div>
                        {/* Modified value */}
                        <Input
                          className={`flex-1 min-w-0 h-7 text-xs ${
                            isDeleted
                              ? "border-red-500/50 bg-red-500/5 line-through"
                              : tag.edited
                                ? "border-primary/50 bg-primary/5"
                                : ""
                          }`}
                          value={tag.value}
                          onChange={(e) => handleTagChange(key, e.target.value)}
                          placeholder={isDeleted ? "(deleted)" : undefined}
                        />
                        {/* Action buttons */}
                        <div className="shrink-0 flex items-center gap-0.5">
                          {tag.edited && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => handleRevertTag(key)}
                              title="Revert to original"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-red-500"
                            onClick={() => handleDeleteTag(key)}
                            title="Delete tag"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    // Normal mode: horizontal layout
                    <>
                      {/* Original value */}
                      <div
                        className="flex-1 min-w-0 text-xs text-muted-foreground bg-muted/30 px-2 py-1.5 rounded truncate"
                        title={tag.originalValue || "(empty)"}
                      >
                        {tag.originalValue || (
                          <span className="italic">(empty)</span>
                        )}
                      </div>

                      {/* Modified value */}
                      <Input
                        className={`flex-1 min-w-0 h-7 text-xs ${
                          isDeleted
                            ? "border-red-500/50 bg-red-500/5 line-through"
                            : tag.edited
                              ? "border-primary/50 bg-primary/5"
                              : ""
                        }`}
                        value={tag.value}
                        onChange={(e) => handleTagChange(key, e.target.value)}
                        placeholder={isDeleted ? "(deleted)" : undefined}
                      />

                      {/* Action buttons */}
                      <div className="w-14 shrink-0 flex items-center gap-0.5 justify-end">
                        {tag.edited && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => handleRevertTag(key)}
                            title="Revert to original"
                          >
                            <RotateCcw className="w-3 h-3" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-red-500"
                          onClick={() => handleDeleteTag(key)}
                          title="Delete tag"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </>
                  )
                ) : (
                  <>
                    {/* For multiple tracks, just show the input */}
                    <Input
                      className={`flex-1 h-7 text-xs ${tag.edited ? "border-primary/50 bg-primary/5" : ""}`}
                      value={tag.mixed ? "" : tag.value}
                      placeholder={
                        tag.mixed
                          ? `(${selectedTracks.length} different values)`
                          : undefined
                      }
                      onChange={(e) => handleTagChange(key, e.target.value)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-red-500"
                      onClick={() => handleDeleteTag(key)}
                      title="Delete tag"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </>
                )}
              </div>
            );
          })}

          {sortedTagKeys.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No tags found
            </p>
          )}

          {/* Add new tag section */}
          <div className="pt-3 border-t border-border/30 mt-3">
            <div className="flex items-center gap-1">
              <Input
                className="flex-1 h-7 text-xs"
                value={newTagKey}
                onChange={(e) => setNewTagKey(e.target.value.toUpperCase())}
                placeholder="New tag name..."
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTagKey.trim()) {
                    handleAddTag(newTagKey);
                  }
                }}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 px-2">
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="max-h-64 overflow-auto"
                >
                  {availableTagsToAdd.map((tag) => (
                    <DropdownMenuItem
                      key={tag}
                      onClick={() => handleAddTag(tag)}
                    >
                      {tag}
                    </DropdownMenuItem>
                  ))}
                  {availableTagsToAdd.length === 0 && (
                    <DropdownMenuItem disabled>
                      All common tags added
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                onClick={() => handleAddTag(newTagKey)}
                disabled={!newTagKey.trim()}
              >
                <Plus className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Discard changes button */}
      {selectedTracksHaveChanges && (
        <div className="p-3 border-t border-border/40">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleDiscardAllChanges}
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Discard changes in selected{" "}
            {selectedTracks.length === 1 ? "track" : "tracks"}
          </Button>
        </div>
      )}

      {/* Preview Player - only show for single track */}
      {singleTrack && (
        <div className="p-3 border-t border-border/40 shrink-0">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => {
                const client = getClient();
                if (!client) return;

                if (preview.isPlaying) {
                  preview.pause();
                } else {
                  // Priority: replacement audio > staged file > library stream
                  if (singleTrack.hasReplacementAudio) {
                    const url = client.getReplacementAudioStreamUrl(
                      singleTrack.track.id,
                    );
                    preview.playUrl(url, singleTrack.track.id, 0);
                  } else if (singleTrack.track.isStaged) {
                    const url = client.getStagedFileStreamUrl(
                      singleTrack.track.id,
                    );
                    preview.playUrl(url, singleTrack.track.id, 0);
                  } else {
                    preview.play(singleTrack.track.id, 0);
                  }
                }
              }}
              disabled={preview.isLoading}
            >
              {preview.isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : preview.isPlaying ? (
                <Pause className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4" />
              )}
            </Button>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-muted-foreground truncate mb-1">
                {singleTrack.hasReplacementAudio
                  ? `🔊 ${singleTrack.replacementAudioOriginalName ?? "Replacement audio"}`
                  : singleTrack.track.filePath.split("/").pop()}
              </div>
              <Slider
                value={[preview.progress]}
                onValueChange={(value) => preview.seek(value[0])}
                max={100}
                step={0.1}
                className="cursor-pointer"
              />
            </div>
            <div
              ref={volumeContainerRef}
              className="flex items-center gap-1 shrink-0"
            >
              <Volume2 className="w-3.5 h-3.5 text-muted-foreground" />
              <Slider
                value={[preview.volume]}
                onValueChange={(value) => preview.setVolume(value[0])}
                max={100}
                step={1}
                className="w-14 cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}

      <Dialog open={coverArtModalOpen} onOpenChange={setCoverArtModalOpen}>
        <DialogContent className="max-w-2xl p-2">
          <VisuallyHidden>
            <DialogTitle>Cover Art Preview</DialogTitle>
            <DialogDescription>Full size cover art preview</DialogDescription>
          </VisuallyHidden>
          {coverArtModalType === "original" && originalCoverArtUrl ? (
            <div className="relative w-full aspect-square">
              <Image
                src={originalCoverArtUrl}
                alt="Original cover art"
                className="w-full h-full object-contain rounded"
                fill
                unoptimized
              />
            </div>
          ) : (
            (coverArtDisplay.type === "preview" ||
              coverArtDisplay.type === "existing") && (
              <div className="relative w-full aspect-square">
                <Image
                  src={
                    coverArtDisplay.type === "existing" &&
                    "songId" in coverArtDisplay
                      ? (getClient()?.getCoverArtUrl(
                          coverArtDisplay.songId.startsWith("so-")
                            ? coverArtDisplay.songId
                            : `so-${coverArtDisplay.songId}`,
                          "large",
                        ) ?? coverArtDisplay.src)
                      : coverArtDisplay.src
                  }
                  alt="Cover art"
                  className="w-full h-full object-contain rounded"
                  fill
                  unoptimized
                />
              </div>
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
