"use client";

import { useState, useRef, ChangeEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2,
  Upload,
  AlertCircle,
  FileSpreadsheet,
  ArrowUpDown,
  Download,
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getClient } from "@/lib/api/client";
import type { ImportMode } from "@/lib/api/generated/ImportMode";
import {
  MatchableTrack,
  SearchOptions,
  MatchingProgress,
  SearchOptionsControl,
  MatchSummary,
  TabbedTrackList,
  useTrackMatcher,
  ParsedTrackInfo,
} from "@/components/playlists/track-matcher";

import { parseCSVLine } from "@/lib/utils/playlist-parser";

interface ImportPlayCountsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ImportStep = "upload" | "matching" | "preview" | "importing";

interface ParsedCsvRow {
  title: string | null;
  artist: string | null;
  album: string | null;
  duration: number | null;
  playCount: number;
  raw: string;
}

// Extended MatchableTrack with play count info
interface PlayCountTrack extends MatchableTrack {
  importPlayCount: number;
  existingPlayCount?: number;
  // Index into csvRows for original line export
  csvRowIndex: number;
}

type SortOption = "playCount" | "title" | "artist" | "previewTotal";

function parseCSV(csvText: string): ParsedCsvRow[] {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  // Parse header using proper CSV parser
  const headers = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase());

  // Find column indices
  const titleIdx = headers.findIndex((h) =>
    ["title", "name", "track", "song"].includes(h),
  );
  const artistIdx = headers.findIndex((h) => ["artist", "artists"].includes(h));
  const albumIdx = headers.findIndex((h) => ["album"].includes(h));
  const durationIdx = headers.findIndex((h) =>
    ["duration", "length", "time", "duration_ms"].includes(h),
  );
  const durationIsMillis = headers[durationIdx] === "duration_ms";
  const playCountIdx = headers.findIndex((h) =>
    ["play_count", "playcount", "plays", "count", "scrobbles"].includes(h),
  );

  if (titleIdx === -1 || playCountIdx === -1) {
    throw new Error(
      "CSV must have 'title' and 'play_count' (or 'plays') columns",
    );
  }

  const rows: ParsedCsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Use proper CSV parser that handles quoted fields
    const values = parseCSVLine(line);

    const playCount = parseInt(values[playCountIdx] || "0", 10);
    if (isNaN(playCount) || playCount <= 0) continue;

    const title = titleIdx >= 0 ? values[titleIdx] || null : null;
    const artist = artistIdx >= 0 ? values[artistIdx] || null : null;
    const album = albumIdx >= 0 ? values[albumIdx] || null : null;

    let duration: number | null = null;
    if (durationIdx >= 0 && values[durationIdx]) {
      const dur = parseInt(values[durationIdx], 10);
      if (!isNaN(dur)) {
        // Convert milliseconds to seconds if needed
        duration = durationIsMillis ? Math.round(dur / 1000) : dur;
      }
    }

    rows.push({
      title,
      artist,
      album,
      duration,
      playCount,
      raw: line,
    });
  }

  return rows;
}

export function ImportPlayCountsDialog({
  open,
  onOpenChange,
}: ImportPlayCountsDialogProps) {
  const { matchTracks, cancel: cancelMatching } = useTrackMatcher();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<ImportStep>("upload");
  const [csvRows, setCsvRows] = useState<ParsedCsvRow[]>([]);
  const [csvHeaderLine, setCsvHeaderLine] = useState<string>("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [matchedTracks, setMatchedTracks] = useState<PlayCountTrack[]>([]);
  const [matchingProgress, setMatchingProgress] = useState(0);
  const [searchOptions, setSearchOptions] = useState<SearchOptions>({
    useTitle: true,
    useArtist: true,
    useAlbum: true,
    usePriorMatches: true,
  });
  const [importMode, setImportMode] = useState<ImportMode>("append");
  const [description, setDescription] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("playCount");
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  // Counts
  const matchedCount = matchedTracks.filter((t) => t.match).length;
  const selectedCount = matchedTracks.filter(
    (t) => t.match && t.selected !== false,
  ).length;
  const unmatchedCount = matchedTracks.filter((t) => !t.match).length;
  const totalPlaysToImport = matchedTracks
    .filter((t) => t.match && t.selected !== false)
    .reduce((sum, t) => sum + t.importPlayCount, 0);

  const hasUnsavedChanges = step === "preview" && selectedCount > 0;

  // Check for duplicate imports by description (debounced)
  const trimmedDescription = description.trim();
  const duplicateCheck = useQuery({
    queryKey: ["import-duplicate-check", trimmedDescription],
    queryFn: async () => {
      const client = getClient();
      if (!client || !trimmedDescription) return null;
      return client.checkImportDuplicate(trimmedDescription);
    },
    enabled: !!trimmedDescription && step === "preview",
    staleTime: 30000, // Cache for 30 seconds
  });

  const hasDuplicateWarning =
    duplicateCheck.data?.exists && duplicateCheck.data.songCount > 0;

  // Handle file upload
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      try {
        // Store the original header line for export
        const lines = text.trim().split(/\r?\n/);
        if (lines.length > 0) {
          setCsvHeaderLine(lines[0]);
        }

        const rows = parseCSV(text);
        if (rows.length === 0) {
          setParseError("No valid rows found in CSV");
          return;
        }
        setCsvRows(rows);
        setParseError(null);
      } catch (err) {
        setParseError(
          err instanceof Error ? err.message : "Failed to parse CSV",
        );
      }
    };
    reader.readAsText(file);
  };

  // Start matching
  const doMatchTracks = async () => {
    setStep("matching");
    setMatchingProgress(0);

    const tracksToMatch: ParsedTrackInfo[] = csvRows.map((row) => ({
      title: row.title,
      artist: row.artist,
      album: row.album,
      duration: row.duration,
      raw: row.raw,
    }));

    const result = await matchTracks(
      tracksToMatch,
      searchOptions,
      setMatchingProgress,
    );

    if (result) {
      // Fetch existing play counts for matched songs
      const client = getClient();
      const matchedSongIds = result
        .filter((t) => t.match)
        .map((t) => t.match!.id);

      let existingCounts: Record<string, number> = {};
      if (client && matchedSongIds.length > 0) {
        try {
          const countsResponse = await client.getPlayCounts(matchedSongIds);
          existingCounts = Object.fromEntries(
            countsResponse.counts.map((c) => [c.songId, Number(c.playCount)]),
          );
        } catch (e) {
          console.error("Failed to fetch existing play counts:", e);
        }
      }

      // Combine match results with play counts
      const tracksWithCounts: PlayCountTrack[] = result.map((track, index) => ({
        ...track,
        importPlayCount: csvRows[index].playCount,
        existingPlayCount: track.match
          ? (existingCounts[track.match.id] ?? 0)
          : undefined,
        csvRowIndex: index,
      }));

      setMatchedTracks(tracksWithCounts);
      setStep("preview");
    } else {
      setStep("upload");
    }
  };

  // Sort tracks
  const getSortedTracks = () => {
    const tracks = [...matchedTracks];
    switch (sortBy) {
      case "playCount":
        return tracks.sort((a, b) => b.importPlayCount - a.importPlayCount);
      case "previewTotal":
        return tracks.sort((a, b) => {
          const totalA = (a.existingPlayCount ?? 0) + a.importPlayCount;
          const totalB = (b.existingPlayCount ?? 0) + b.importPlayCount;
          return totalB - totalA;
        });
      case "title":
        return tracks.sort((a, b) =>
          (a.parsed.title ?? "").localeCompare(b.parsed.title ?? ""),
        );
      case "artist":
        return tracks.sort((a, b) =>
          (a.parsed.artist ?? "").localeCompare(b.parsed.artist ?? ""),
        );
      default:
        return tracks;
    }
  };

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      const entries = matchedTracks
        .filter((t) => t.match && t.selected !== false)
        .map((t) => ({
          songId: t.match!.id,
          playCount: t.importPlayCount,
        }));

      return client.importScrobbles({
        entries,
        mode: importMode,
        description: description.trim() || null,
      });
    },
    onSuccess: (result) => {
      toast.success(
        `Imported ${result.totalPlaysImported} plays for ${result.songsImported} songs`,
      );
      resetAndClose();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to import play counts",
      );
      setStep("preview");
    },
  });

  const handleImport = () => {
    if (importMode === "replace") {
      setConfirmReplaceOpen(true);
    } else {
      setStep("importing");
      importMutation.mutate();
    }
  };

  const confirmAndImport = () => {
    setConfirmReplaceOpen(false);
    setStep("importing");
    importMutation.mutate();
  };

  const resetAndClose = () => {
    cancelMatching();
    setStep("upload");
    setCsvRows([]);
    setCsvHeaderLine("");
    setParseError(null);
    setMatchedTracks([]);
    setMatchingProgress(0);
    setDescription("");
    setImportMode("append");
    setConfirmCloseOpen(false);
    setConfirmReplaceOpen(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    onOpenChange(false);
  };

  const handleCloseRequest = () => {
    if (hasUnsavedChanges) {
      setConfirmCloseOpen(true);
    } else {
      resetAndClose();
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      handleCloseRequest();
    } else {
      onOpenChange(newOpen);
    }
  };

  // Download unmatched tracks in the same CSV format
  const downloadUnmatched = () => {
    const unmatchedTracks = matchedTracks.filter((t) => !t.match);
    if (unmatchedTracks.length === 0) return;

    // Build CSV with header and original lines
    const lines: string[] = [];
    if (csvHeaderLine) {
      lines.push(csvHeaderLine);
    }
    for (const track of unmatchedTracks) {
      // Get the original row from csvRows using the stored index
      const row = csvRows[track.csvRowIndex];
      if (row) {
        lines.push(row.raw);
      }
    }

    const content = lines.join("\n") + "\n";
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "unmatched_play_counts.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="w-[95vw] max-w-[1200px] h-[90vh] max-h-[90vh] flex flex-col overflow-hidden"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            handleCloseRequest();
          }}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5" />
              Import Play Counts
            </DialogTitle>
            <DialogDescription>
              Import play counts from a CSV file and match tracks to your
              library.
            </DialogDescription>
          </DialogHeader>

          {/* Upload Step */}
          {step === "upload" && (
            <div className="py-4 space-y-4 flex-1">
              <div className="border-2 border-dashed rounded-lg p-8 text-center">
                <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-lg font-medium mb-2">Upload CSV File</p>
                <p className="text-sm text-muted-foreground mb-4">
                  Required columns: title, play_count (or plays)
                  <br />
                  Optional: artist, album, duration
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.tsv,.txt"
                  onChange={handleFileChange}
                  className="hidden"
                  id="csv-upload"
                />
                <Button asChild>
                  <label htmlFor="csv-upload" className="cursor-pointer">
                    <Upload className="w-4 h-4 mr-2" />
                    Select File
                  </label>
                </Button>
              </div>

              {parseError && (
                <div className="flex items-center gap-2 p-4 bg-destructive/10 rounded-lg text-destructive">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <span>{parseError}</span>
                </div>
              )}

              {csvRows.length > 0 && (
                <div className="p-4 bg-muted/30 rounded-lg space-y-4">
                  <p className="text-sm">
                    <strong>{csvRows.length}</strong> tracks loaded with{" "}
                    <strong>
                      {csvRows.reduce((sum, r) => sum + r.playCount, 0)}
                    </strong>{" "}
                    total plays
                  </p>
                  <SearchOptionsControl
                    options={searchOptions}
                    onChange={setSearchOptions}
                  />
                </div>
              )}
            </div>
          )}

          {/* Matching Step */}
          {step === "matching" && (
            <MatchingProgress
              tracksCount={csvRows.length}
              progress={matchingProgress}
            />
          )}

          {/* Preview Step */}
          {step === "preview" && (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="grid gap-4 py-4 shrink-0">
                {/* Search options */}
                <SearchOptionsControl
                  options={searchOptions}
                  onChange={setSearchOptions}
                  onRematch={doMatchTracks}
                  showRematch
                />

                {/* Match summary + import options */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <MatchSummary
                    matchedCount={matchedCount}
                    unmatchedCount={unmatchedCount}
                  />

                  <div className="flex items-center gap-4">
                    {/* Sort control */}
                    <div className="flex items-center gap-2">
                      <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
                      <Select
                        value={sortBy}
                        onValueChange={(v) => setSortBy(v as SortOption)}
                      >
                        <SelectTrigger className="w-[160px] h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="playCount">
                            Import Count
                          </SelectItem>
                          <SelectItem value="previewTotal">
                            Preview Total
                          </SelectItem>
                          <SelectItem value="title">Title</SelectItem>
                          <SelectItem value="artist">Artist</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Replace mode toggle */}
                    <div className="flex items-center gap-2">
                      <Switch
                        id="replace-mode"
                        checked={importMode === "replace"}
                        onCheckedChange={(checked) =>
                          setImportMode(checked ? "replace" : "append")
                        }
                      />
                      <Label htmlFor="replace-mode" className="text-sm">
                        Replace existing
                      </Label>
                    </div>
                  </div>
                </div>

                {/* Description input */}
                <div className="flex items-center gap-2">
                  <Label htmlFor="import-description" className="shrink-0">
                    Description:
                  </Label>
                  <Input
                    id="import-description"
                    placeholder="e.g., CSV import Dec 2024"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className={`flex-1 ${hasDuplicateWarning ? "border-yellow-500" : ""}`}
                  />
                </div>

                {/* Duplicate import warning */}
                {hasDuplicateWarning && duplicateCheck.data && (
                  <div className="flex items-center gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-600 dark:text-yellow-400 text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>
                      An import with this description already exists (
                      {duplicateCheck.data.songCount} songs,{" "}
                      {duplicateCheck.data.totalPlays} plays). This may be a
                      duplicate import.
                    </span>
                  </div>
                )}
              </div>

              {/* Track list */}
              <TabbedTrackList
                tracks={getSortedTracks()}
                onUpdateMatch={(index, match, score) => {
                  const sortedTracks = getSortedTracks();
                  const originalTrack = sortedTracks[index];
                  const originalIndex = matchedTracks.indexOf(originalTrack);
                  if (originalIndex >= 0) {
                    setMatchedTracks((prev) => {
                      const updated = [...prev];
                      updated[originalIndex] = {
                        ...updated[originalIndex],
                        match,
                        matchScore: score,
                        // Auto-select only if match confidence is 90% or higher
                        selected: match
                          ? score >= 0.9
                          : updated[originalIndex].selected,
                      };
                      return updated;
                    });
                  }
                }}
                onToggleSelection={(index, selected) => {
                  const sortedTracks = getSortedTracks();
                  const originalTrack = sortedTracks[index];
                  const originalIndex = matchedTracks.indexOf(originalTrack);
                  if (originalIndex >= 0) {
                    setMatchedTracks((prev) => {
                      const updated = [...prev];
                      updated[originalIndex] = {
                        ...updated[originalIndex],
                        selected,
                      };
                      return updated;
                    });
                  }
                }}
                onToggleAllSelection={(trackList, selected) => {
                  const indicesToUpdate = new Set(
                    trackList
                      .filter((t) => t.match && !t.locked)
                      .map((t) => matchedTracks.indexOf(t as PlayCountTrack)),
                  );
                  setMatchedTracks((prev) =>
                    prev.map((track, idx) =>
                      indicesToUpdate.has(idx) ? { ...track, selected } : track,
                    ),
                  );
                }}
                showMatchFilter
                showCheckboxes
                renderTrackExtra={
                  sortBy === "playCount" || sortBy === "previewTotal"
                    ? (track) => {
                        const t = track as PlayCountTrack;
                        if (sortBy === "playCount") {
                          return (
                            <span className="text-xs font-medium">
                              +{t.importPlayCount}
                            </span>
                          );
                        }
                        // previewTotal
                        const existing = t.existingPlayCount ?? 0;
                        const total = existing + t.importPlayCount;
                        return (
                          <span className="text-xs">
                            <span className="text-muted-foreground">
                              {existing} + {t.importPlayCount} ={" "}
                            </span>
                            <span className="font-medium">{total}</span>
                          </span>
                        );
                      }
                    : undefined
                }
              />
            </div>
          )}

          {/* Importing Step */}
          {step === "importing" && (
            <div className="py-8 text-center">
              <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-primary" />
              <p className="text-lg font-medium">Importing play counts...</p>
            </div>
          )}

          <DialogFooter className="shrink-0">
            {step === "preview" && unmatchedCount > 0 && (
              <Button
                variant="outline"
                className="mr-auto"
                onClick={downloadUnmatched}
              >
                <Download className="w-4 h-4 mr-2" />
                Download Unmatched
              </Button>
            )}

            <Button variant="outline" onClick={handleCloseRequest}>
              Cancel
            </Button>

            {step === "upload" && csvRows.length > 0 && (
              <Button onClick={doMatchTracks}>Start Matching</Button>
            )}

            {step === "preview" && (
              <Button
                onClick={handleImport}
                disabled={selectedCount === 0 || importMutation.isPending}
              >
                {importMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  `Import ${totalPlaysToImport} plays for ${selectedCount} songs`
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Replace mode confirmation */}
      <AlertDialog
        open={confirmReplaceOpen}
        onOpenChange={setConfirmReplaceOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace existing play counts?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete all existing play counts for the {selectedCount}{" "}
              selected songs before importing. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmAndImport}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/80"
            >
              Replace and Import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Close confirmation */}
      <AlertDialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard import?</AlertDialogTitle>
            <AlertDialogDescription>
              You have {selectedCount} songs ready to import. Are you sure you
              want to close and discard your progress?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue Editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={resetAndClose}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/80"
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
