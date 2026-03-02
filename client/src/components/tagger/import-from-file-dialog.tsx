"use client";

import { useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  restrictToVerticalAxis,
  restrictToFirstScrollableAncestor,
} from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  FileAudio,
  Music,
  Image as ImageIcon,
  Tags,
  Upload,
  X,
  GripVertical,
  ArrowRight,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface ImportFromFileOptions {
  importAudio: boolean;
  importTags: boolean;
  importCoverArt: boolean;
  /** If true ands files were selected via directory picker, delete source files after import */
  moveFiles: boolean;
}

/** File with a stable ID for drag and drop */
interface FileWithId {
  id: string;
  file: File;
  /** Handle for removing the file from the source directory (move operation) */
  handle?: FileSystemFileHandle;
  /** Parent directory handle needed for removeEntry */
  parentHandle?: FileSystemDirectoryHandle;
}

/** Sortable file item component */
function SortableFileItem({
  fileWithId,
  targetTrack,
  showTargetSection,
  showDragHandle,
  onRemove,
}: {
  fileWithId: FileWithId;
  targetTrack?: string;
  showTargetSection: boolean;
  showDragHandle: boolean;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: fileWithId.id });

  // Only apply transform to the draggable portion
  const draggableStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div className="flex items-center gap-2 text-sm h-8">
      {/* Left side: draggable file info (50%) */}
      <div
        ref={setNodeRef}
        style={draggableStyle}
        className={cn(
          "flex items-center gap-1.5 bg-muted rounded px-2 py-1.5 h-full flex-1 min-w-0",
          isDragging && "opacity-50 shadow-lg ring-2 ring-primary",
        )}
      >
        {/* Drag handle for batch mode */}
        {showDragHandle && (
          <button
            type="button"
            aria-label="Drag to reorder"
            className={cn(
              "cursor-grab text-muted-foreground/50 hover:text-muted-foreground shrink-0 touch-none",
              isDragging && "cursor-grabbing",
            )}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}

        {/* File info */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <FileAudio className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="truncate" title={fileWithId.file.name}>
            {fileWithId.file.name}
          </span>
        </div>

        {/* Remove button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="h-5 w-5 p-0 hover:bg-destructive/20 shrink-0"
          title="Remove file"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Arrow separator and target track - always shown when showTargetSection is true for consistent width */}
      {showTargetSection && (
        <>
          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />

          {/* Right side: static target track (50%) */}
          <div className="flex items-center gap-1.5 bg-muted/50 rounded px-2 py-1.5 h-full flex-1 min-w-0">
            {targetTrack ? (
              <>
                <Music className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="truncate" title={targetTrack}>
                  {targetTrack}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground/50 italic text-xs">
                No target track
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

interface ImportFromFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Number of tracks being targeted (for batch operations) */
  trackCount: number;
  /** Names of target tracks (for showing file-to-track mapping) */
  trackNames?: string[];
  onConfirm: (
    options: ImportFromFileOptions,
    files: File[],
    /** File handles for move operation - present if files were chosen via directory picker */
    fileHandles?: {
      handle: FileSystemFileHandle;
      parentHandle: FileSystemDirectoryHandle;
    }[],
  ) => void;
}

export function ImportFromFileDialog({
  open,
  onOpenChange,
  trackCount,
  trackNames = [],
  onConfirm,
}: ImportFromFileDialogProps) {
  const [importAudio, setImportAudio] = useState(true);
  const [importTags, setImportTags] = useState(false);
  const [importCoverArt, setImportCoverArt] = useState(false);
  const [moveFiles, setMoveFiles] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<FileWithId[]>([]);
  const [hasDirectoryHandles, setHasDirectoryHandles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileIdCounter = useRef(0);

  const supportsDirectoryPicker =
    typeof window !== "undefined" && "showDirectoryPicker" in window;

  // Reset state when dialog opens via onOpenChange handler
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setImportAudio(true);
      setImportTags(false);
      setImportCoverArt(false);
      setMoveFiles(false);
      setSelectedFiles([]);
      setHasDirectoryHandles(false);
    }
    onOpenChange(newOpen);
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const hasOptions = importAudio || importTags || importCoverArt;
  const isBatch = trackCount > 1;

  // For batch: need exactly trackCount files; for single: need exactly 1 file
  const hasCorrectFileCount = isBatch
    ? selectedFiles.length === trackCount
    : selectedFiles.length === 1;
  const isValid = hasOptions && hasCorrectFileCount;

  function handleConfirm() {
    if (!isValid) return;
    const options = {
      importAudio,
      importTags,
      importCoverArt,
      moveFiles: moveFiles && hasDirectoryHandles,
    };
    const handles =
      moveFiles && hasDirectoryHandles
        ? selectedFiles
            .filter((f) => f.handle && f.parentHandle)
            .map((f) => ({ handle: f.handle!, parentHandle: f.parentHandle! }))
        : undefined;
    onConfirm(
      options,
      selectedFiles.map((f) => f.file),
      handles,
    );
    onOpenChange(false);
  }

  function handleCancel() {
    onOpenChange(false);
  }

  function handleChooseFiles() {
    fileInputRef.current?.click();
  }

  async function handleChooseDirectory() {
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      const audioExtensions = new Set([
        ".mp3",
        ".flac",
        ".m4a",
        ".aac",
        ".ogg",
        ".opus",
        ".wav",
        ".wma",
        ".aiff",
        ".alac",
      ]);
      const filesWithIds: FileWithId[] = [];

      for await (const entry of dirHandle.values()) {
        if (entry.kind !== "file") continue;
        const ext =
          entry.name.lastIndexOf(".") >= 0
            ? entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase()
            : "";
        if (!audioExtensions.has(ext)) continue;
        const file = await entry.getFile();
        filesWithIds.push({
          id: `file-${++fileIdCounter.current}`,
          file,
          handle: entry,
          parentHandle: dirHandle,
        });
      }

      // Sort by filename for a predictable order
      filesWithIds.sort((a, b) => a.file.name.localeCompare(b.file.name));

      if (filesWithIds.length > 0) {
        setSelectedFiles((prev) => [...prev, ...filesWithIds]);
        setHasDirectoryHandles(true);
      }
    } catch {
      // User cancelled the picker
    }
  }

  function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files && files.length > 0) {
      const filesWithIds = Array.from(files).map((file) => ({
        id: `file-${++fileIdCounter.current}`,
        file,
      }));
      // Append new files to existing list
      setSelectedFiles((prev) => [...prev, ...filesWithIds]);
    }
    e.target.value = "";
  }

  function handleRemoveFile(id: string) {
    setSelectedFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setSelectedFiles((prev) => {
        const oldIndex = prev.findIndex((f) => f.id === active.id);
        const newIndex = prev.findIndex((f) => f.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }

  function handleClearFiles() {
    setSelectedFiles([]);
    setHasDirectoryHandles(false);
    setMoveFiles(false);
  }

  const title = "Replace with File";
  const description = isBatch
    ? `Choose what to replace from audio files for ${trackCount} selected tracks.`
    : "Choose what to replace from an audio file.";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl lg:max-w-4xl xl:max-w-5xl overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileAudio className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-start space-x-3">
            <Checkbox
              id="import-audio"
              checked={importAudio}
              onCheckedChange={(checked) => setImportAudio(checked === true)}
            />
            <div className="grid gap-1.5 leading-none">
              <Label
                htmlFor="import-audio"
                className="flex items-center gap-2 cursor-pointer"
              >
                <Music className="h-4 w-4 text-muted-foreground" />
                Replace audio
              </Label>
              <p className="text-sm text-muted-foreground">
                Replace the audio data with the uploaded file
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <Checkbox
              id="import-tags"
              checked={importTags}
              onCheckedChange={(checked) => setImportTags(checked === true)}
            />
            <div className="grid gap-1.5 leading-none">
              <Label
                htmlFor="import-tags"
                className="flex items-center gap-2 cursor-pointer"
              >
                <Tags className="h-4 w-4 text-muted-foreground" />
                Import tags
              </Label>
              <p className="text-sm text-muted-foreground">
                Import metadata tags (title, artist, album, etc.) from the file
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <Checkbox
              id="import-cover-art"
              checked={importCoverArt}
              onCheckedChange={(checked) => setImportCoverArt(checked === true)}
            />
            <div className="grid gap-1.5 leading-none">
              <Label
                htmlFor="import-cover-art"
                className="flex items-center gap-2 cursor-pointer"
              >
                <ImageIcon className="h-4 w-4 text-muted-foreground" />
                Import cover art
              </Label>
              <p className="text-sm text-muted-foreground">
                Import embedded cover art from the file
              </p>
            </div>
          </div>

          {!hasOptions && (
            <p className="text-sm text-destructive">
              Please select at least one option to import.
            </p>
          )}

          {/* File selection section */}
          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                {isBatch
                  ? `Files (${selectedFiles.length}/${trackCount} required)`
                  : "File"}
              </Label>
              {selectedFiles.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearFiles}
                  className="h-6 px-2 text-xs"
                >
                  Clear all
                </Button>
              )}
            </div>

            {selectedFiles.length === 0 ? (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={handleChooseFiles}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {isBatch ? `Choose ${trackCount} files...` : "Choose file..."}
                </Button>
                {supportsDirectoryPicker && isBatch && (
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={handleChooseDirectory}
                  >
                    <FolderOpen className="h-4 w-4 mr-2" />
                    Choose directory...
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  modifiers={[
                    restrictToVerticalAxis,
                    restrictToFirstScrollableAncestor,
                  ]}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={selectedFiles.map((f) => f.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="max-h-64 overflow-y-auto overflow-x-hidden space-y-1">
                      {selectedFiles.map((fileWithId, index) => (
                        <SortableFileItem
                          key={fileWithId.id}
                          fileWithId={fileWithId}
                          targetTrack={trackNames[index]}
                          showTargetSection={isBatch}
                          showDragHandle={isBatch}
                          onRemove={() => handleRemoveFile(fileWithId.id)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={handleChooseFiles}
                  >
                    <Upload className="h-3 w-3 mr-2" />
                    {isBatch ? "Select files..." : "Select file..."}
                  </Button>
                  {supportsDirectoryPicker && isBatch && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={handleChooseDirectory}
                    >
                      <FolderOpen className="h-3 w-3 mr-2" />
                      Select directory...
                    </Button>
                  )}
                </div>
              </div>
            )}

            {isBatch && selectedFiles.length > 0 && !hasCorrectFileCount && (
              <p className="text-sm text-destructive">
                Please select exactly {trackCount} files (one for each selected
                track, in order).
              </p>
            )}

            {hasDirectoryHandles && (
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="move-files"
                  checked={moveFiles}
                  onCheckedChange={(checked) => setMoveFiles(checked === true)}
                />
                <div className="grid gap-1.5 leading-none">
                  <Label
                    htmlFor="move-files"
                    className="cursor-pointer text-sm"
                  >
                    Move files (delete originals after import)
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Remove source files from the selected directory after
                    successful import
                  </p>
                </div>
              </div>
            )}

            <input
              type="file"
              ref={fileInputRef}
              accept="audio/*"
              multiple={isBatch}
              className="hidden"
              onChange={handleFilesSelected}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!isValid}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
