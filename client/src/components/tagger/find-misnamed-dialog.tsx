"use client";

import { useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { Loader2, Search, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  taggerScriptsAtom,
  taggerSessionAtom,
  taggerTracksAtom,
  createTrackState,
} from "@/lib/store/tagger";
import { getClient } from "@/lib/api/client";
import type { SongPathMetadata } from "@/lib/api/generated/SongPathMetadata";

// Characters that are dangerous in filenames across Windows, Linux, macOS
const DANGEROUS_CHARS_REGEX = /[\\/:*?"<>|\x00]/g;

function sanitizePathSegment(
  segment: string,
  mode: "ignore" | "strip" | "replace",
  replacement: string,
): string {
  if (mode === "ignore") return segment;
  if (mode === "strip") return segment.replace(DANGEROUS_CHARS_REGEX, "");
  return segment.replace(DANGEROUS_CHARS_REGEX, replacement);
}

function processScriptResult(
  result: unknown,
  mode: "ignore" | "strip" | "replace",
  replacement: string,
): string | null {
  if (Array.isArray(result)) {
    const sanitizedSegments = result
      .filter((seg) => typeof seg === "string" && seg.trim())
      .map((seg) => sanitizePathSegment(seg as string, mode, replacement));
    if (sanitizedSegments.length === 0) return null;
    return sanitizedSegments.join("/");
  } else if (typeof result === "string" && result.trim()) {
    const segments = result.split("/").filter((s) => s.trim());
    const sanitizedSegments = segments.map((seg) =>
      sanitizePathSegment(seg, mode, replacement),
    );
    if (sanitizedSegments.length === 0) return null;
    return sanitizedSegments.join("/");
  }
  return null;
}

function computeExpectedPath(
  song: SongPathMetadata,
  scriptCode: string,
  dangerousCharMode: "ignore" | "strip" | "replace",
  dangerousCharReplacement: string,
): string | null {
  const filePath = song.filePath;
  const parts = filePath.split("/");
  const fullFilename = parts[parts.length - 1];
  const dotIdx = fullFilename.lastIndexOf(".");
  const filename = dotIdx > 0 ? fullFilename.slice(0, dotIdx) : fullFilename;
  const ext = dotIdx > 0 ? fullFilename.slice(dotIdx + 1) : song.ext;

  const context: Record<string, string> = {
    filename,
    ext,
    filepath: filePath,
    title: song.title,
    artist: song.artist,
    albumartist: song.albumArtist,
    album: song.album,
    genre: song.genre,
    year: song.year,
    tracknumber: song.trackNumber,
    tracktotal: song.trackTotal,
    discnumber: song.discNumber,
    disctotal: song.discTotal,
    comment: "",
    composer: "",
  };

  try {
    const fn = new Function(...Object.keys(context), scriptCode);
    const result = fn(...Object.values(context));
    return processScriptResult(
      result,
      dangerousCharMode,
      dangerousCharReplacement,
    );
  } catch {
    return null;
  }
}

interface MismatchedSong {
  id: string;
  currentPath: string;
  expectedPath: string;
}

interface FindMisnamedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FindMisnamedDialog({
  open,
  onOpenChange,
}: FindMisnamedDialogProps) {
  const scripts = useAtomValue(taggerScriptsAtom);
  const [session, setSession] = useAtom(taggerSessionAtom);
  const [tracks, setTracks] = useAtom(taggerTracksAtom);
  const renameScripts = scripts.filter((s) => s.type === "rename");

  const [selectedScriptId, setSelectedScriptId] = useState<string>(
    session.activeRenameScriptId ?? "",
  );
  const [isSearching, setIsSearching] = useState(false);
  const [mismatches, setMismatches] = useState<MismatchedSong[]>([]);
  const [selectedSongIds, setSelectedSongIds] = useState<Set<string>>(
    new Set(),
  );
  const [hasSearched, setHasSearched] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  const handleSearch = async () => {
    const script = renameScripts.find((s) => s.id === selectedScriptId);
    if (!script) {
      toast.error("Please select a rename script");
      return;
    }

    const client = getClient();
    if (!client) return;

    setIsSearching(true);
    setMismatches([]);
    setSelectedSongIds(new Set());
    setHasSearched(false);

    try {
      const response = await client.getSongPaths();
      const dangerousCharMode = (session.dangerousCharMode ?? "replace") as
        | "ignore"
        | "strip"
        | "replace";
      const dangerousCharReplacement = session.dangerousCharReplacement ?? "_";

      const results: MismatchedSong[] = [];

      for (const song of response.songs) {
        const expectedPath = computeExpectedPath(
          song,
          script.script,
          dangerousCharMode,
          dangerousCharReplacement,
        );

        if (expectedPath && expectedPath !== song.filePath) {
          results.push({
            id: song.id,
            currentPath: song.filePath,
            expectedPath,
          });
        }
      }

      setMismatches(results);
      setSelectedSongIds(new Set(results.map((r) => r.id)));
      setHasSearched(true);
    } catch (err) {
      console.error("Search error:", err);
      toast.error("Failed to search for misnamed songs");
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddSelected = async () => {
    const ids = Array.from(selectedSongIds);
    if (ids.length === 0) {
      toast.error("No songs selected");
      return;
    }

    const client = getClient();
    if (!client) return;

    // Filter out songs already in session
    const existingIds = new Set(session.tracks.map((t) => t.id));
    const newIds = ids.filter((id) => !existingIds.has(id));

    if (newIds.length === 0) {
      toast.info("All selected songs are already in the tagger session");
      return;
    }

    setIsAdding(true);
    try {
      const response = await client.stageLibraryTracks(newIds);

      const newTracks = new Map(tracks);
      const addedIds: string[] = [];

      for (const track of response.tracks) {
        const trackState = createTrackState(track);
        newTracks.set(track.id, trackState);
        addedIds.push(track.id);
      }

      setTracks(newTracks);
      setSession({
        ...session,
        tracks: [
          ...session.tracks,
          ...addedIds.map((id) => ({ id, trackType: "library" as const })),
        ],
      });

      toast.success(`Added ${addedIds.length} song(s) to tagger session`);
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to add tracks:", error);
      toast.error("Failed to add tracks to tagger session");
    } finally {
      setIsAdding(false);
    }
  };

  const toggleSong = (id: string) => {
    setSelectedSongIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedSongIds.size === mismatches.length) {
      setSelectedSongIds(new Set());
    } else {
      setSelectedSongIds(new Set(mismatches.map((m) => m.id)));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="w-5 h-5" />
            Find Misnamed Songs
          </DialogTitle>
          <DialogDescription>
            Find songs whose file paths don&apos;t match the selected rename
            script and add them to the tagger session for batch renaming.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <Select value={selectedScriptId} onValueChange={setSelectedScriptId}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select a rename script" />
            </SelectTrigger>
            <SelectContent>
              {renameScripts.map((script) => (
                <SelectItem key={script.id} value={script.id}>
                  {script.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={handleSearch}
            disabled={!selectedScriptId || isSearching}
          >
            {isSearching ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Searching...
              </>
            ) : (
              "Search"
            )}
          </Button>
        </div>

        {/* Results */}
        {hasSearched && (
          <div className="flex flex-col min-h-0 flex-1">
            {mismatches.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Search className="w-8 h-8 mb-2" />
                <p>All songs match the rename script!</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={
                        selectedSongIds.size === mismatches.length &&
                        mismatches.length > 0
                      }
                      onCheckedChange={toggleAll}
                    />
                    <span className="text-sm text-muted-foreground">
                      {mismatches.length} mismatched{" "}
                      {mismatches.length === 1 ? "song" : "songs"} found
                      {selectedSongIds.size > 0 && (
                        <> ({selectedSongIds.size} selected)</>
                      )}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleAddSelected}
                    disabled={selectedSongIds.size === 0 || isAdding}
                  >
                    {isAdding ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        Adding...
                      </>
                    ) : (
                      "Add Selected to Tagger"
                    )}
                  </Button>
                </div>

                <ScrollArea className="flex-1 min-h-0 border rounded-md">
                  <div className="divide-y">
                    {mismatches.map((mismatch) => (
                      <label
                        key={mismatch.id}
                        className="flex items-start gap-3 p-3 hover:bg-muted/50 cursor-pointer"
                      >
                        <Checkbox
                          checked={selectedSongIds.has(mismatch.id)}
                          onCheckedChange={() => toggleSong(mismatch.id)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1 text-sm">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                            <span className="truncate">
                              {mismatch.currentPath}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground/70 truncate mt-0.5">
                            Expected: {mismatch.expectedPath}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
