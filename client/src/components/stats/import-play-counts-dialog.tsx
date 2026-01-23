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
  Clock,
  Calendar,
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
import type { PlayEvent } from "@/lib/api/generated/PlayEvent";
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
type FileType = "csv" | "json";

// Individual play event with timestamp (used when timestamps are present)
interface PlayEventData {
  playedAt: string; // ISO 8601 timestamp
  durationSeconds: number;
  isScrobble: boolean; // Whether this counts as a scrobble
}

// Unified parsed track - works for both CSV and JSON
// If plays array is present, timestamps are available; otherwise just play counts
interface ParsedImportTrack {
  title: string | null;
  artist: string | null;
  album: string | null;
  duration: number | null; // Track duration for matching (not listening time)
  // Play count mode (no timestamps)
  playCount: number;
  // Timestamp mode (individual play events)
  plays?: PlayEventData[];
  totalDurationSeconds?: number;
  scrobbleCount?: number;
  firstPlayed?: string | null;
  lastPlayed?: string | null;
  // Original raw data for export
  raw: string;
}

// Extended MatchableTrack with play count info
interface PlayCountTrack extends MatchableTrack {
  importPlayCount: number;
  existingPlayCount?: number;
  // Index into parsed tracks
  rowIndex: number;
  // Timestamp data (if available)
  plays?: PlayEventData[];
  totalDurationSeconds?: number;
  scrobbleCount?: number;
  firstPlayed?: string | null;
  lastPlayed?: string | null;
}

type SortOption =
  | "playCount"
  | "title"
  | "artist"
  | "previewTotal"
  | "duration"
  | "lastPlayed";

// ============================================================================
// CSV Parsing Result
// ============================================================================

interface CsvParseResult {
  tracks: ParsedImportTrack[];
  headerLine: string;
  hasTimestamps: boolean;
}

// ============================================================================
// CSV Parsing
// ============================================================================

function parseCSV(csvText: string): CsvParseResult {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2)
    return { tracks: [], headerLine: "", hasTimestamps: false };

  // Parse header using proper CSV parser
  const headers = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase());
  const headerLine = lines[0];

  // Find column indices
  const titleIdx = headers.findIndex((h) =>
    ["title", "name", "track", "song"].includes(h),
  );
  const artistIdx = headers.findIndex((h) => ["artist", "artists"].includes(h));
  const albumIdx = headers.findIndex((h) => ["album"].includes(h));
  const durationIdx = headers.findIndex((h) =>
    ["duration", "length", "time", "duration_ms", "ms_played"].includes(h),
  );
  const durationIsMillis = ["duration_ms", "ms_played"].includes(
    headers[durationIdx],
  );
  const playCountIdx = headers.findIndex((h) =>
    ["play_count", "playcount", "plays", "count", "scrobbles"].includes(h),
  );
  const timestampIdx = headers.findIndex((h) =>
    [
      "timestamp",
      "played_at",
      "ts",
      "datetime",
      "date",
      "time_played",
      "listened_at",
    ].includes(h),
  );

  const hasTimestamps = timestampIdx !== -1;

  if (titleIdx === -1) {
    throw new Error("CSV must have a 'title' column");
  }

  // If no timestamps, we need a play count column
  if (!hasTimestamps && playCountIdx === -1) {
    throw new Error(
      "CSV must have either a 'timestamp' column (for per-play data) or 'play_count' column (for aggregated counts)",
    );
  }

  if (hasTimestamps) {
    // Parse as individual play events, then aggregate
    const trackMap = new Map<string, ParsedImportTrack>();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values = parseCSVLine(line);

      const title = titleIdx >= 0 ? values[titleIdx] || null : null;
      if (!title) continue;

      const artist = artistIdx >= 0 ? values[artistIdx] || null : null;
      const album = albumIdx >= 0 ? values[albumIdx] || null : null;

      // Parse timestamp
      const timestampStr = values[timestampIdx] || "";
      if (!timestampStr) continue;

      // Parse duration if available
      let durationSeconds = 0;
      if (durationIdx >= 0 && values[durationIdx]) {
        const dur = parseFloat(values[durationIdx]);
        if (!isNaN(dur)) {
          durationSeconds = durationIsMillis
            ? Math.round(dur / 1000)
            : Math.round(dur);
        }
      }

      // Determine if this is a scrobble (duration >= 30s or assume full play if no duration)
      const isScrobble = durationSeconds >= 30 || durationSeconds === 0;

      // Parse timestamp to ISO format
      let playedAt: string;
      try {
        const parsed = new Date(timestampStr);
        if (isNaN(parsed.getTime())) {
          continue; // Skip invalid timestamps
        }
        playedAt = parsed.toISOString();
      } catch {
        continue;
      }

      // Aggregate by (artist, album, title)
      const key = `${(artist ?? "").toLowerCase()}|||${(album ?? "").toLowerCase()}|||${title.toLowerCase()}`;

      const existing = trackMap.get(key);
      if (existing) {
        existing.plays!.push({
          playedAt,
          durationSeconds,
          isScrobble,
        });
        existing.totalDurationSeconds! += durationSeconds;
        if (isScrobble) {
          existing.scrobbleCount!++;
        }
        existing.playCount++;
        // Update date range
        if (!existing.firstPlayed || playedAt < existing.firstPlayed) {
          existing.firstPlayed = playedAt;
        }
        if (!existing.lastPlayed || playedAt > existing.lastPlayed) {
          existing.lastPlayed = playedAt;
        }
      } else {
        trackMap.set(key, {
          title,
          artist,
          album,
          duration: null, // Not used for matching when we have play events
          playCount: 1,
          plays: [
            {
              playedAt,
              durationSeconds,
              isScrobble,
            },
          ],
          totalDurationSeconds: durationSeconds,
          scrobbleCount: isScrobble ? 1 : 0,
          firstPlayed: playedAt,
          lastPlayed: playedAt,
          raw: line,
        });
      }
    }

    return {
      tracks: Array.from(trackMap.values()),
      headerLine,
      hasTimestamps: true,
    };
  } else {
    // Parse as aggregated play counts (no timestamps)
    const tracks: ParsedImportTrack[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values = parseCSVLine(line);

      const playCount = parseInt(values[playCountIdx] || "0", 10);
      if (isNaN(playCount) || playCount <= 0) continue;

      const title = titleIdx >= 0 ? values[titleIdx] || null : null;
      if (!title) continue;

      const artist = artistIdx >= 0 ? values[artistIdx] || null : null;
      const album = albumIdx >= 0 ? values[albumIdx] || null : null;

      let duration: number | null = null;
      if (durationIdx >= 0 && values[durationIdx]) {
        const dur = parseInt(values[durationIdx], 10);
        if (!isNaN(dur)) {
          duration = durationIsMillis ? Math.round(dur / 1000) : dur;
        }
      }

      tracks.push({
        title,
        artist,
        album,
        duration,
        playCount,
        raw: line,
      });
    }

    return { tracks, headerLine, hasTimestamps: false };
  }
}

// ============================================================================
// JSON Parsing Result
// ============================================================================

interface JsonParseResult {
  tracks: ParsedImportTrack[];
  hasTimestamps: boolean;
}

// ============================================================================
// JSON Parsing (Spotify Extended Streaming History and similar formats)
// ============================================================================

interface JsonEntry {
  // Spotify Extended Streaming History fields
  ts?: string;
  ms_played?: number;
  master_metadata_track_name?: string | null;
  master_metadata_album_artist_name?: string | null;
  master_metadata_album_album_name?: string | null;
  reason_end?: string;
  skipped?: boolean;
  // Alternative field names
  timestamp?: string;
  played_at?: string;
  datetime?: string;
  date?: string;
  duration_ms?: number;
  duration?: number;
  duration_seconds?: number;
  track_name?: string;
  title?: string;
  track?: string;
  name?: string;
  song?: string;
  artist_name?: string;
  artist?: string;
  artists?: string;
  album_name?: string;
  album?: string;
  // Aggregated format fields (no timestamps)
  play_count?: number;
  playcount?: number;
  plays?: number;
  count?: number;
  scrobbles?: number;
  // Episode fields (for filtering)
  episode_name?: string | null;
  episode_show_name?: string | null;
}

function getFieldValue<T>(
  entry: JsonEntry,
  ...keys: (keyof JsonEntry)[]
): T | null {
  for (const key of keys) {
    const value = entry[key];
    if (value !== undefined && value !== null && value !== "") {
      return value as T;
    }
  }
  return null;
}

function parseJsonEntries(jsonText: string): JsonParseResult {
  let entries: JsonEntry[];

  try {
    const parsed = JSON.parse(jsonText);
    // Handle both array and single object
    entries = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    throw new Error("Invalid JSON format");
  }

  if (entries.length === 0) {
    throw new Error("No entries found in JSON");
  }

  // Check if entries have timestamps (streaming history format)
  // vs aggregated format (pre-aggregated play counts)
  const firstValidEntry = entries.find(
    (e) => !e.episode_name && !e.episode_show_name,
  );
  const hasTimestampField =
    firstValidEntry &&
    getFieldValue<string>(
      firstValidEntry,
      "ts",
      "timestamp",
      "played_at",
      "datetime",
      "date",
    ) !== null;

  const hasPlayCountField =
    firstValidEntry &&
    getFieldValue<number>(
      firstValidEntry,
      "play_count",
      "playcount",
      "plays",
      "count",
      "scrobbles",
    ) !== null;

  // If has play_count but no timestamp, treat as aggregated format
  if (hasPlayCountField && !hasTimestampField) {
    // Aggregated format - each entry is already a unique track with play count
    const tracks: ParsedImportTrack[] = [];

    for (const entry of entries) {
      if (entry.episode_name || entry.episode_show_name) continue;

      const title = getFieldValue<string>(
        entry,
        "master_metadata_track_name",
        "track_name",
        "title",
        "track",
        "name",
        "song",
      );
      if (!title) continue;

      const artist = getFieldValue<string>(
        entry,
        "master_metadata_album_artist_name",
        "artist_name",
        "artist",
        "artists",
      );
      const album = getFieldValue<string>(
        entry,
        "master_metadata_album_album_name",
        "album_name",
        "album",
      );

      const playCount =
        getFieldValue<number>(
          entry,
          "play_count",
          "playcount",
          "plays",
          "count",
          "scrobbles",
        ) ?? 0;

      if (playCount <= 0) continue;

      tracks.push({
        title,
        artist,
        album,
        duration: null,
        playCount,
        raw: JSON.stringify(entry),
      });
    }

    return { tracks, hasTimestamps: false };
  }

  // Streaming history format - individual play events with timestamps
  // Group by (artist, album, title) key
  const trackMap = new Map<string, ParsedImportTrack>();

  for (const entry of entries) {
    // Skip podcast episodes
    if (entry.episode_name || entry.episode_show_name) {
      continue;
    }

    // Extract fields using common field name variations
    const title = getFieldValue<string>(
      entry,
      "master_metadata_track_name",
      "track_name",
      "title",
      "track",
      "name",
      "song",
    );
    const artist = getFieldValue<string>(
      entry,
      "master_metadata_album_artist_name",
      "artist_name",
      "artist",
      "artists",
    );
    const album = getFieldValue<string>(
      entry,
      "master_metadata_album_album_name",
      "album_name",
      "album",
    );

    // Skip entries without title
    if (!title) continue;

    // Extract timestamp
    const timestamp = getFieldValue<string>(
      entry,
      "ts",
      "timestamp",
      "played_at",
      "datetime",
      "date",
    );

    // Extract duration
    let durationSeconds = 0;
    const msPlayed = entry.ms_played ?? entry.duration_ms;
    if (msPlayed !== undefined) {
      durationSeconds = Math.round(msPlayed / 1000);
    } else if (entry.duration !== undefined) {
      // Heuristic: if duration > 10000, assume milliseconds
      durationSeconds =
        entry.duration > 10000
          ? Math.round(entry.duration / 1000)
          : entry.duration;
    } else if (entry.duration_seconds !== undefined) {
      durationSeconds = entry.duration_seconds;
    }

    // Determine if this play counts as a scrobble:
    // - reason_end === "trackdone" (completed the track), OR
    // - duration >= 30 seconds (listened to significant portion)
    const isScrobble =
      entry.reason_end === "trackdone" || durationSeconds >= 30;

    // Skip entries with no duration at all (probably invalid)
    if (durationSeconds <= 0) continue;

    // Create aggregation key
    const key = `${(artist ?? "").toLowerCase()}|||${(album ?? "").toLowerCase()}|||${title.toLowerCase()}`;

    const existing = trackMap.get(key);
    if (existing) {
      existing.plays!.push({
        playedAt: timestamp || new Date().toISOString(),
        durationSeconds,
        isScrobble,
      });
      existing.totalDurationSeconds! += durationSeconds;
      if (isScrobble) {
        existing.scrobbleCount!++;
      }
      existing.playCount++;
      // Update date range
      if (timestamp) {
        if (!existing.firstPlayed || timestamp < existing.firstPlayed) {
          existing.firstPlayed = timestamp;
        }
        if (!existing.lastPlayed || timestamp > existing.lastPlayed) {
          existing.lastPlayed = timestamp;
        }
      }
    } else {
      trackMap.set(key, {
        title,
        artist,
        album,
        duration: null,
        playCount: 1,
        plays: [
          {
            playedAt: timestamp || new Date().toISOString(),
            durationSeconds,
            isScrobble,
          },
        ],
        totalDurationSeconds: durationSeconds,
        scrobbleCount: isScrobble ? 1 : 0,
        firstPlayed: timestamp || null,
        lastPlayed: timestamp || null,
        raw: JSON.stringify(entry),
      });
    }
  }

  return { tracks: Array.from(trackMap.values()), hasTimestamps: true };
}

// ============================================================================
// Utility functions
// ============================================================================

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatDateRange(first: string | null, last: string | null): string {
  if (!first || !last) return "";
  const firstDate = new Date(first);
  const lastDate = new Date(last);
  const formatDate = (d: Date) =>
    d.toLocaleDateString(undefined, {
      month: "short",
      year: "numeric",
    });
  if (
    firstDate.getFullYear() === lastDate.getFullYear() &&
    firstDate.getMonth() === lastDate.getMonth()
  ) {
    return formatDate(firstDate);
  }
  return `${formatDate(firstDate)} – ${formatDate(lastDate)}`;
}

// ============================================================================
// Component
// ============================================================================

export function ImportPlayCountsDialog({
  open,
  onOpenChange,
}: ImportPlayCountsDialogProps) {
  const { matchTracks, cancel: cancelMatching } = useTrackMatcher();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<ImportStep>("upload");
  const [fileType, setFileType] = useState<FileType>("csv");

  // Unified parsed tracks (works for both CSV and JSON)
  const [parsedTracks, setParsedTracks] = useState<ParsedImportTrack[]>([]);
  const [headerLine, setHeaderLine] = useState<string>(""); // For CSV export
  const [hasTimestamps, setHasTimestamps] = useState(false);

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

  // For timestamp imports, count scrobbles; for play count imports, count plays
  const totalPlaysToImport = matchedTracks
    .filter((t) => t.match && t.selected !== false)
    .reduce((sum, t) => sum + (t.scrobbleCount ?? t.importPlayCount), 0);

  const totalSessionsToImport = hasTimestamps
    ? matchedTracks
        .filter((t) => t.match && t.selected !== false)
        .reduce((sum, t) => sum + (t.plays?.length ?? 0), 0)
    : 0;

  const totalDurationToImport = hasTimestamps
    ? matchedTracks
        .filter((t) => t.match && t.selected !== false)
        .reduce((sum, t) => sum + (t.totalDurationSeconds ?? 0), 0)
    : 0;

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
        // Detect file type from extension or content
        const isJson =
          file.name.endsWith(".json") ||
          text.trim().startsWith("[") ||
          text.trim().startsWith("{");

        if (isJson) {
          setFileType("json");
          const result = parseJsonEntries(text);
          if (result.tracks.length === 0) {
            setParseError("No valid tracks found in JSON");
            return;
          }
          setParsedTracks(result.tracks);
          setHeaderLine("");
          setHasTimestamps(result.hasTimestamps);
          setParseError(null);
        } else {
          setFileType("csv");
          const result = parseCSV(text);
          if (result.tracks.length === 0) {
            setParseError("No valid rows found in CSV");
            return;
          }
          setParsedTracks(result.tracks);
          setHeaderLine(result.headerLine);
          setHasTimestamps(result.hasTimestamps);
          setParseError(null);
        }
      } catch (err) {
        setParseError(
          err instanceof Error ? err.message : "Failed to parse file",
        );
      }
    };
    reader.readAsText(file);
  };

  // Start matching
  const doMatchTracks = async () => {
    setStep("matching");
    setMatchingProgress(0);

    const tracksToMatch: ParsedTrackInfo[] = parsedTracks.map((track) => ({
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      raw: track.raw,
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
      const tracksWithCounts: PlayCountTrack[] = result.map((track, index) => {
        const parsed = parsedTracks[index];
        return {
          ...track,
          importPlayCount: parsed.playCount,
          scrobbleCount: parsed.scrobbleCount,
          existingPlayCount: track.match
            ? (existingCounts[track.match.id] ?? 0)
            : undefined,
          rowIndex: index,
          plays: parsed.plays,
          totalDurationSeconds: parsed.totalDurationSeconds,
          firstPlayed: parsed.firstPlayed,
          lastPlayed: parsed.lastPlayed,
        };
      });

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
        return tracks.sort(
          (a, b) =>
            (b.scrobbleCount ?? b.importPlayCount) -
            (a.scrobbleCount ?? a.importPlayCount),
        );
      case "previewTotal":
        return tracks.sort((a, b) => {
          const totalA =
            (a.existingPlayCount ?? 0) + (a.scrobbleCount ?? a.importPlayCount);
          const totalB =
            (b.existingPlayCount ?? 0) + (b.scrobbleCount ?? b.importPlayCount);
          return totalB - totalA;
        });
      case "duration":
        return tracks.sort(
          (a, b) =>
            (b.totalDurationSeconds ?? 0) - (a.totalDurationSeconds ?? 0),
        );
      case "lastPlayed":
        return tracks.sort((a, b) => {
          const dateA = a.lastPlayed ? new Date(a.lastPlayed).getTime() : 0;
          const dateB = b.lastPlayed ? new Date(b.lastPlayed).getTime() : 0;
          return dateB - dateA;
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

  // Import mutation for play counts only (no timestamps)
  const playCountsImportMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      const entries = matchedTracks
        .filter((t) => t.match && t.selected !== false)
        .map((t) => ({
          songId: t.match!.id,
          playCount: t.scrobbleCount ?? t.importPlayCount,
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

  // Import mutation for timestamps (listening sessions + scrobbles)
  const timestampsImportMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      const songs = matchedTracks
        .filter((t) => t.match && t.selected !== false && t.plays)
        .map((t) => ({
          songId: t.match!.id,
          plays: t.plays!.map(
            (p): PlayEvent => ({
              playedAt: p.playedAt,
              durationSeconds: p.durationSeconds,
              isScrobble: p.isScrobble,
            }),
          ),
        }));

      return client.importWithTimestamps({
        songs,
        mode: importMode,
        description: description.trim() || null,
      });
    },
    onSuccess: (result) => {
      toast.success(
        `Imported ${result.scrobblesImported} scrobbles and ${result.sessionsImported} listening sessions for ${result.songsImported} songs`,
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

  const importMutation = hasTimestamps
    ? timestampsImportMutation
    : playCountsImportMutation;

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
    setParsedTracks([]);
    setHeaderLine("");
    setHasTimestamps(false);
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

  // Download unmatched tracks
  const downloadUnmatched = () => {
    const unmatchedTracks = matchedTracks.filter((t) => !t.match);
    if (unmatchedTracks.length === 0) return;

    if (fileType === "csv") {
      // Build CSV with header and original lines
      const lines: string[] = [];
      if (headerLine) {
        lines.push(headerLine);
      }
      for (const track of unmatchedTracks) {
        const parsed = parsedTracks[track.rowIndex];
        if (parsed) {
          lines.push(parsed.raw);
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
    } else {
      // Export as JSON
      const unmatchedData = unmatchedTracks.map((track) => {
        const parsed = parsedTracks[track.rowIndex];
        return {
          title: parsed.title,
          artist: parsed.artist,
          album: parsed.album,
          playCount: parsed.scrobbleCount ?? parsed.playCount,
          totalDurationSeconds: parsed.totalDurationSeconds,
        };
      });

      const content = JSON.stringify(unmatchedData, null, 2);
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "unmatched_play_counts.json";
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  // Upload summary stats
  const getUploadSummary = () => {
    if (!hasTimestamps) {
      // Play counts only mode
      const totalPlays = parsedTracks.reduce((sum, t) => sum + t.playCount, 0);
      return (
        <p className="text-sm">
          <strong>{parsedTracks.length}</strong> tracks loaded with{" "}
          <strong>{totalPlays}</strong> total plays
        </p>
      );
    } else {
      // Timestamp mode - show play events, scrobbles, and duration
      const totalPlays = parsedTracks.reduce((sum, t) => sum + t.playCount, 0);
      const totalScrobbles = parsedTracks.reduce(
        (sum, t) => sum + (t.scrobbleCount ?? 0),
        0,
      );
      const totalDuration = parsedTracks.reduce(
        (sum, t) => sum + (t.totalDurationSeconds ?? 0),
        0,
      );
      return (
        <div className="text-sm space-y-1">
          <p>
            <strong>{parsedTracks.length}</strong> unique tracks from{" "}
            <strong>{totalPlays}</strong> play events
          </p>
          <p className="text-muted-foreground">
            <strong>{totalScrobbles}</strong> scrobbles •{" "}
            <strong>{formatDuration(totalDuration)}</strong> total listening
            time
          </p>
        </div>
      );
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
              <FileSpreadsheet className="w-5 h-5" />
              Import Play Counts
            </DialogTitle>
            <DialogDescription>
              Import play counts from CSV or JSON files (including Spotify
              Extended Streaming History).
            </DialogDescription>
          </DialogHeader>

          {/* Upload Step */}
          {step === "upload" && (
            <div className="py-4 space-y-4 flex-1">
              <div className="border-2 border-dashed rounded-lg p-8 text-center">
                <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-lg font-medium mb-2">
                  Upload CSV or JSON File
                </p>
                <p className="text-sm text-muted-foreground mb-4">
                  <strong>CSV:</strong> Required columns: title, play_count (or
                  plays)
                  <br />
                  <strong>JSON:</strong> Spotify Extended Streaming History or
                  similar formats
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.tsv,.txt,.json"
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

              {parsedTracks.length > 0 && (
                <div className="p-4 bg-muted/30 rounded-lg space-y-4">
                  {getUploadSummary()}
                  {hasTimestamps && (
                    <p className="text-xs text-muted-foreground">
                      <Clock className="w-3 h-3 inline mr-1" />
                      Timestamps will be preserved for Year in Review stats
                    </p>
                  )}
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
              tracksCount={parsedTracks.length}
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
                            {hasTimestamps ? "Scrobbles" : "Import Count"}
                          </SelectItem>
                          <SelectItem value="previewTotal">
                            Preview Total
                          </SelectItem>
                          {hasTimestamps && (
                            <>
                              <SelectItem value="duration">
                                Listening Time
                              </SelectItem>
                              <SelectItem value="lastPlayed">
                                Last Played
                              </SelectItem>
                            </>
                          )}
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
                    placeholder={
                      hasTimestamps
                        ? "e.g., Spotify history 2019-2026"
                        : "e.g., CSV import Dec 2024"
                    }
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

                {/* Timestamp import summary */}
                {hasTimestamps && selectedCount > 0 && (
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {formatDuration(totalDurationToImport)} listening time
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-4 h-4" />
                      {totalSessionsToImport} sessions → {totalPlaysToImport}{" "}
                      scrobbles
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
                renderTrackExtra={(track) => {
                  const t = track as PlayCountTrack;
                  if (hasTimestamps && t.plays) {
                    // Timestamp mode: show scrobbles, duration, and date range
                    const scrobbles = t.scrobbleCount ?? 0;
                    const existing = t.existingPlayCount ?? 0;
                    const duration = t.totalDurationSeconds ?? 0;
                    const dateRange = formatDateRange(
                      t.firstPlayed ?? null,
                      t.lastPlayed ?? null,
                    );

                    if (sortBy === "duration" || sortBy === "lastPlayed") {
                      return (
                        <div className="text-xs text-right">
                          <div className="font-medium">
                            {formatDuration(duration)}
                          </div>
                          <div className="text-muted-foreground">
                            {scrobbles} scrobbles • {dateRange}
                          </div>
                        </div>
                      );
                    }

                    if (sortBy === "previewTotal") {
                      return (
                        <div className="text-xs text-right">
                          <div>
                            <span className="text-muted-foreground">
                              {existing} + {scrobbles} ={" "}
                            </span>
                            <span className="font-medium">
                              {existing + scrobbles}
                            </span>
                          </div>
                          <div className="text-muted-foreground">
                            {formatDuration(duration)}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div className="text-xs text-right">
                        <div className="font-medium">+{scrobbles}</div>
                        <div className="text-muted-foreground">
                          {formatDuration(duration)}
                          {dateRange && ` • ${dateRange}`}
                        </div>
                      </div>
                    );
                  } else {
                    // Play count mode: show play count
                    const playCount = t.scrobbleCount ?? t.importPlayCount;
                    if (sortBy === "playCount") {
                      return (
                        <span className="text-xs font-medium">
                          +{playCount}
                        </span>
                      );
                    }
                    if (sortBy === "previewTotal") {
                      const existing = t.existingPlayCount ?? 0;
                      const total = existing + playCount;
                      return (
                        <span className="text-xs">
                          <span className="text-muted-foreground">
                            {existing} + {playCount} ={" "}
                          </span>
                          <span className="font-medium">{total}</span>
                        </span>
                      );
                    }
                    return null;
                  }
                }}
              />
            </div>
          )}

          {/* Importing Step */}
          {step === "importing" && (
            <div className="py-8 text-center">
              <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-primary" />
              <p className="text-lg font-medium">Importing play counts...</p>
              {hasTimestamps && (
                <p className="text-sm text-muted-foreground mt-2">
                  Creating {totalSessionsToImport} listening sessions...
                </p>
              )}
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

            {step === "upload" && parsedTracks.length > 0 && (
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
                ) : hasTimestamps ? (
                  `Import ${totalPlaysToImport} scrobbles for ${selectedCount} songs`
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
              This will delete all existing play counts{" "}
              {hasTimestamps && "and listening sessions "}
              for the {selectedCount} selected songs before importing. This
              action cannot be undone.
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
