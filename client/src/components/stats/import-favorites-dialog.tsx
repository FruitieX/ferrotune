"use client";

import { useState, useRef, ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2,
  Upload,
  AlertCircle,
  FileSpreadsheet,
  Heart,
  Music,
  Disc,
  User,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getClient } from "@/lib/api/client";
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

interface ImportFavoritesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ImportStep = "upload" | "matching" | "preview" | "importing";
type FavoriteType = "songs" | "albums" | "artists";

interface ParsedFavorite {
  title: string | null;
  artist: string | null;
  album: string | null;
  duration: number | null;
  raw: string;
}

// Extended MatchableTrack for favorites import
interface FavoriteTrack extends MatchableTrack {
  csvRowIndex: number;
}

function parseCSV(csvText: string, type: FavoriteType): ParsedFavorite[] {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  // Parse header using proper CSV parser
  const headers = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase());

  // Find column indices based on type
  let titleIdx: number;
  let artistIdx: number;
  let albumIdx: number;
  let durationIdx: number;

  if (type === "songs") {
    // For songs: title, artist, album optional
    titleIdx = headers.findIndex((h) =>
      ["title", "name", "track", "song"].includes(h),
    );
    artistIdx = headers.findIndex((h) => ["artist", "artists"].includes(h));
    albumIdx = headers.findIndex((h) => ["album"].includes(h));
    durationIdx = headers.findIndex((h) =>
      ["duration", "length", "time", "duration_ms"].includes(h),
    );

    if (titleIdx === -1) {
      throw new Error("CSV must have a 'title' (or 'name', 'track', 'song') column for songs");
    }
  } else if (type === "albums") {
    // For albums: album name is required, artist optional
    albumIdx = headers.findIndex((h) =>
      ["album", "name", "title"].includes(h),
    );
    artistIdx = headers.findIndex((h) => ["artist", "artists", "album_artist"].includes(h));
    titleIdx = -1;
    durationIdx = -1;

    if (albumIdx === -1) {
      throw new Error("CSV must have an 'album' (or 'name', 'title') column for albums");
    }
  } else {
    // For artists: artist name is required
    artistIdx = headers.findIndex((h) =>
      ["artist", "name", "title"].includes(h),
    );
    titleIdx = -1;
    albumIdx = -1;
    durationIdx = -1;

    if (artistIdx === -1) {
      throw new Error("CSV must have an 'artist' (or 'name', 'title') column for artists");
    }
  }

  const durationIsMillis = durationIdx >= 0 && headers[durationIdx] === "duration_ms";

  const rows: ParsedFavorite[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Use proper CSV parser that handles quoted fields
    const values = parseCSVLine(line);

    const title = titleIdx >= 0 ? values[titleIdx] || null : null;
    const artist = artistIdx >= 0 ? values[artistIdx] || null : null;
    const album = albumIdx >= 0 ? values[albumIdx] || null : null;

    let duration: number | null = null;
    if (durationIdx >= 0 && values[durationIdx]) {
      const dur = parseInt(values[durationIdx], 10);
      if (!isNaN(dur)) {
        duration = durationIsMillis ? Math.round(dur / 1000) : dur;
      }
    }

    // For albums, use album as "title" for matching display
    // For artists, use artist as "title"
    const displayTitle =
      type === "albums" ? album : type === "artists" ? artist : title;

    rows.push({
      title: displayTitle,
      artist: type === "artists" ? null : artist,
      album: type === "songs" ? album : null,
      duration,
      raw: line,
    });
  }

  return rows;
}

export function ImportFavoritesDialog({
  open,
  onOpenChange,
}: ImportFavoritesDialogProps) {
  const { matchTracks, cancel: cancelMatching } = useTrackMatcher();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<ImportStep>("upload");
  const [favoriteType, setFavoriteType] = useState<FavoriteType>("songs");
  const [csvRows, setCsvRows] = useState<ParsedFavorite[]>([]);
  const [csvHeaderLine, setCsvHeaderLine] = useState<string>("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [matchedTracks, setMatchedTracks] = useState<FavoriteTrack[]>([]);
  const [matchingProgress, setMatchingProgress] = useState(0);
  const [searchOptions, setSearchOptions] = useState<SearchOptions>({
    useTitle: true,
    useArtist: true,
    useAlbum: true,
  });
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  // Counts
  const matchedCount = matchedTracks.filter((t) => t.match).length;
  const selectedCount = matchedTracks.filter(
    (t) => t.match && t.selected !== false,
  ).length;
  const unmatchedCount = matchedTracks.filter((t) => !t.match).length;

  const hasUnsavedChanges = step === "preview" && selectedCount > 0;

  // Handle file upload
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      try {
        const lines = text.trim().split(/\r?\n/);
        if (lines.length > 0) {
          setCsvHeaderLine(lines[0]);
        }

        const rows = parseCSV(text, favoriteType);
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

  // Reset csv rows when favorite type changes
  const handleTypeChange = (type: FavoriteType) => {
    setFavoriteType(type);
    setCsvRows([]);
    setCsvHeaderLine("");
    setParseError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
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
      const tracksWithIndex: FavoriteTrack[] = result.map((track, index) => ({
        ...track,
        csvRowIndex: index,
      }));

      setMatchedTracks(tracksWithIndex);
      setStep("preview");
    } else {
      setStep("upload");
    }
  };

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      const selectedTracks = matchedTracks.filter(
        (t) => t.match && t.selected !== false,
      );

      if (favoriteType === "songs") {
        // For songs, star by song ID
        const ids = selectedTracks.map((t) => t.match!.id);
        await client.star({ id: ids });
        return { count: ids.length };
      } else if (favoriteType === "albums") {
        // For albums, we need to fetch album IDs from matched songs
        // The match contains song data, so we need to get album IDs
        // Use the song's albumId field if available, or fetch song details
        const albumIds = new Set<string>();
        
        for (const track of selectedTracks) {
          // The match.id is a song ID - we need to get its album
          // Songs in our API have albumId field available
          const songResponse = await client.getSong(track.match!.id);
          if (songResponse.song.albumId) {
            albumIds.add(songResponse.song.albumId);
          }
        }
        
        if (albumIds.size > 0) {
          await client.star({ albumId: Array.from(albumIds) });
        }
        return { count: albumIds.size };
      } else {
        // For artists, get artist IDs from matched songs
        const artistIds = new Set<string>();
        
        for (const track of selectedTracks) {
          const songResponse = await client.getSong(track.match!.id);
          if (songResponse.song.artistId) {
            artistIds.add(songResponse.song.artistId);
          }
        }
        
        if (artistIds.size > 0) {
          await client.star({ artistId: Array.from(artistIds) });
        }
        return { count: artistIds.size };
      }
    },
    onSuccess: ({ count }) => {
      toast.success(`Added ${count} ${favoriteType} to favorites`);
      queryClient.invalidateQueries({ queryKey: ["starred"] });
      queryClient.invalidateQueries({ queryKey: ["starred-songs"] });
      queryClient.invalidateQueries({ queryKey: ["starred-albums"] });
      queryClient.invalidateQueries({ queryKey: ["starred-artists"] });
      resetAndClose();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to import favorites",
      );
      setStep("preview");
    },
  });

  const handleImport = () => {
    setStep("importing");
    importMutation.mutate();
  };

  const resetAndClose = () => {
    cancelMatching();
    setStep("upload");
    setFavoriteType("songs");
    setCsvRows([]);
    setCsvHeaderLine("");
    setParseError(null);
    setMatchedTracks([]);
    setMatchingProgress(0);
    setConfirmCloseOpen(false);
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

  // Download unmatched tracks
  const downloadUnmatched = () => {
    const unmatchedTracks = matchedTracks.filter((t) => !t.match);
    if (unmatchedTracks.length === 0) return;

    const lines: string[] = [];
    if (csvHeaderLine) {
      lines.push(csvHeaderLine);
    }
    for (const track of unmatchedTracks) {
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
    a.download = `unmatched_${favoriteType}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getTypeIcon = () => {
    switch (favoriteType) {
      case "songs":
        return <Music className="w-4 h-4" />;
      case "albums":
        return <Disc className="w-4 h-4" />;
      case "artists":
        return <User className="w-4 h-4" />;
    }
  };

  const getTypeLabel = () => {
    switch (favoriteType) {
      case "songs":
        return "liked tracks";
      case "albums":
        return "liked albums";
      case "artists":
        return "liked artists";
    }
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
              <Heart className="w-5 h-5 text-red-500" />
              Import Favorites
            </DialogTitle>
            <DialogDescription>
              Import {getTypeLabel()} from a CSV file and match them to your
              library.
            </DialogDescription>
          </DialogHeader>

          {/* Upload Step */}
          {step === "upload" && (
            <div className="py-4 space-y-4 flex-1">
              {/* Type selector */}
              <Tabs
                value={favoriteType}
                onValueChange={(v) => handleTypeChange(v as FavoriteType)}
              >
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="songs" className="gap-2">
                    <Music className="w-4 h-4" />
                    Songs
                  </TabsTrigger>
                  <TabsTrigger value="albums" className="gap-2">
                    <Disc className="w-4 h-4" />
                    Albums
                  </TabsTrigger>
                  <TabsTrigger value="artists" className="gap-2">
                    <User className="w-4 h-4" />
                    Artists
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="songs" className="mt-4">
                  <div className="border-2 border-dashed rounded-lg p-8 text-center">
                    <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                    <p className="text-lg font-medium mb-2">
                      Upload Liked Tracks CSV
                    </p>
                    <p className="text-sm text-muted-foreground mb-4">
                      Required columns: title (or name, track, song)
                      <br />
                      Optional: artist, album, duration
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.tsv,.txt"
                      onChange={handleFileChange}
                      className="hidden"
                      id="favorites-csv-upload"
                    />
                    <Button asChild>
                      <label
                        htmlFor="favorites-csv-upload"
                        className="cursor-pointer"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        Select File
                      </label>
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="albums" className="mt-4">
                  <div className="border-2 border-dashed rounded-lg p-8 text-center">
                    <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                    <p className="text-lg font-medium mb-2">
                      Upload Liked Albums CSV
                    </p>
                    <p className="text-sm text-muted-foreground mb-4">
                      Required columns: album (or name, title)
                      <br />
                      Optional: artist
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.tsv,.txt"
                      onChange={handleFileChange}
                      className="hidden"
                      id="favorites-csv-upload"
                    />
                    <Button asChild>
                      <label
                        htmlFor="favorites-csv-upload"
                        className="cursor-pointer"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        Select File
                      </label>
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="artists" className="mt-4">
                  <div className="border-2 border-dashed rounded-lg p-8 text-center">
                    <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                    <p className="text-lg font-medium mb-2">
                      Upload Liked Artists CSV
                    </p>
                    <p className="text-sm text-muted-foreground mb-4">
                      Required columns: artist (or name, title)
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.tsv,.txt"
                      onChange={handleFileChange}
                      className="hidden"
                      id="favorites-csv-upload"
                    />
                    <Button asChild>
                      <label
                        htmlFor="favorites-csv-upload"
                        className="cursor-pointer"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        Select File
                      </label>
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>

              {parseError && (
                <div className="flex items-center gap-2 p-4 bg-destructive/10 rounded-lg text-destructive">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <span>{parseError}</span>
                </div>
              )}

              {csvRows.length > 0 && (
                <div className="p-4 bg-muted/30 rounded-lg space-y-4">
                  <p className="text-sm flex items-center gap-2">
                    {getTypeIcon()}
                    <strong>{csvRows.length}</strong> {favoriteType} loaded
                  </p>
                  {favoriteType === "songs" && (
                    <SearchOptionsControl
                      options={searchOptions}
                      onChange={setSearchOptions}
                    />
                  )}
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
                {/* Search options (only for songs) */}
                {favoriteType === "songs" && (
                  <SearchOptionsControl
                    options={searchOptions}
                    onChange={setSearchOptions}
                    onRematch={doMatchTracks}
                    showRematch
                  />
                )}

                {/* Match summary */}
                <MatchSummary
                  matchedCount={matchedCount}
                  unmatchedCount={unmatchedCount}
                />
              </div>

              {/* Track list */}
              <TabbedTrackList
                tracks={matchedTracks}
                onUpdateMatch={(index, match, score) => {
                  setMatchedTracks((prev) => {
                    const updated = [...prev];
                    updated[index] = {
                      ...updated[index],
                      match,
                      matchScore: score,
                      selected: match ? score >= 0.9 : updated[index].selected,
                    };
                    return updated;
                  });
                }}
                onToggleSelection={(index, selected) => {
                  setMatchedTracks((prev) => {
                    const updated = [...prev];
                    updated[index] = {
                      ...updated[index],
                      selected,
                    };
                    return updated;
                  });
                }}
                onToggleAllSelection={(trackList, selected) => {
                  const indicesToUpdate = new Set(
                    trackList
                      .filter((t) => t.match && !t.locked)
                      .map((t) => matchedTracks.indexOf(t as FavoriteTrack)),
                  );
                  setMatchedTracks((prev) =>
                    prev.map((track, idx) =>
                      indicesToUpdate.has(idx) ? { ...track, selected } : track,
                    ),
                  );
                }}
                showMatchFilter
                showCheckboxes
              />
            </div>
          )}

          {/* Importing Step */}
          {step === "importing" && (
            <div className="py-8 text-center">
              <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-primary" />
              <p className="text-lg font-medium">Adding to favorites...</p>
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
                    Adding...
                  </>
                ) : (
                  <>
                    <Heart className="w-4 h-4 mr-2" />
                    Add {selectedCount} to Favorites
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close confirmation */}
      <AlertDialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard import?</AlertDialogTitle>
            <AlertDialogDescription>
              You have {selectedCount} items ready to add to favorites. Are you
              sure you want to close and discard your progress?
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
