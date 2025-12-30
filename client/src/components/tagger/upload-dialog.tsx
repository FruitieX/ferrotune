"use client";

import { useState, useRef } from "react";
import { useAtom } from "jotai";
import { Upload, File, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { getClient } from "@/lib/api/client";
import {
  taggerTracksAtom,
  taggerSessionAtom,
  createTrackState,
} from "@/lib/store/tagger";

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FileUploadStatus {
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

export function UploadDialog({ open, onOpenChange }: UploadDialogProps) {
  const [files, setFiles] = useState<FileUploadStatus[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tracks, setTracks] = useAtom(taggerTracksAtom);
  const [session, setSession] = useAtom(taggerSessionAtom);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      const newFiles: FileUploadStatus[] = Array.from(e.target.files).map(
        (file) => ({
          file,
          status: "pending",
        }),
      );
      setFiles((prev) => [...prev, ...newFiles]);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer.files) {
      const audioFiles = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith("audio/"),
      );
      const newFiles: FileUploadStatus[] = audioFiles.map((file) => ({
        file,
        status: "pending",
      }));
      setFiles((prev) => [...prev, ...newFiles]);
    }
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function uploadFiles() {
    const client = getClient();
    if (!client || files.length === 0) return;

    setIsUploading(true);

    try {
      // Upload all files at once
      const pendingFiles = files.filter((f) => f.status === "pending");
      const filesToUpload = pendingFiles.map((f) => f.file);

      // Mark as uploading
      setFiles((prev) =>
        prev.map((f) =>
          f.status === "pending" ? { ...f, status: "uploading" } : f,
        ),
      );

      const response = await client.uploadTaggerFiles(filesToUpload);

      // Update track states with uploaded files
      const newTracks = new Map(tracks);
      const newTrackIds: string[] = [];

      for (const uploaded of response.files) {
        // Use type assertion since TaggerTrack expects bigint but we work with numbers
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
        const trackState = createTrackState(track);
        newTracks.set(uploaded.id, trackState);
        newTrackIds.push(uploaded.id);
      }

      setTracks(newTracks);
      setSession({
        ...session,
        tracks: [
          ...session.tracks,
          ...newTrackIds.map((id) => ({ id, trackType: "staged" as const })),
        ],
      });

      // Mark as done
      setFiles((prev) =>
        prev.map((f) =>
          f.status === "uploading" ? { ...f, status: "done" } : f,
        ),
      );

      // Close dialog after a short delay
      setTimeout(() => {
        onOpenChange(false);
        setFiles([]);
      }, 500);
    } catch (error) {
      // Mark as error
      setFiles((prev) =>
        prev.map((f) =>
          f.status === "uploading"
            ? { ...f, status: "error", error: String(error) }
            : f,
        ),
      );
    } finally {
      setIsUploading(false);
    }
  }

  const pendingCount = files.filter((f) => f.status === "pending").length;
  const doneCount = files.filter((f) => f.status === "done").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Audio Files</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Drop zone */}
          <div
            className="border-2 border-dashed border-border/40 rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm font-medium">Drop audio files here</p>
            <p className="text-xs text-muted-foreground mt-1">
              or click to browse
            </p>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="audio/*"
              multiple
              onChange={handleFileSelect}
            />
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-auto">
              {files.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 p-2 rounded bg-muted/50"
                >
                  <File className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-sm truncate flex-1">{f.file.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {(f.file.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                  {f.status === "uploading" && (
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  )}
                  {f.status === "done" && (
                    <span className="text-xs text-green-500">✓</span>
                  )}
                  {f.status === "error" && (
                    <span className="text-xs text-red-500">✗</span>
                  )}
                  {f.status === "pending" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => removeFile(i)}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Progress */}
          {isUploading && <Progress value={(doneCount / files.length) * 100} />}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={uploadFiles}
              disabled={pendingCount === 0 || isUploading}
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                `Upload ${pendingCount} file${pendingCount !== 1 ? "s" : ""}`
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
