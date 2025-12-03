"use client";

import { useState, useCallback, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Upload,
  FileMusic,
  Loader2,
  Check,
  X,
  AlertCircle,
  Download,
  Search,
  Music,
  RefreshCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { getClient } from "@/lib/api/client";
import { parsePlaylist, exportOriginalLines, getFormatExtension, getFormatMimeType, type ParsedTrack, type ParseResult } from "@/lib/utils/playlist-parser";
import type { Song } from "@/lib/api/types";

interface ImportPlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface MatchedTrack {
  parsed: ParsedTrack;
  match: Song | null;
  matchScore: number;
}

type ImportStep = "upload" | "matching" | "preview" | "importing";

export function ImportPlaylistDialog({ open, onOpenChange }: ImportPlaylistDialogProps) {
  const [step, setStep] = useState<ImportStep>("upload");
  const [playlistName, setPlaylistName] = useState("");
  const [parsedTracks, setParsedTracks] = useState<ParsedTrack[]>([]);
  const [matchedTracks, setMatchedTracks] = useState<MatchedTrack[]>([]);
  const [matchingProgress, setMatchingProgress] = useState(0);
  const [isMatching, setIsMatching] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [originalFormat, setOriginalFormat] = useState<ParseResult["format"]>("m3u");
  const [originalHeaderLine, setOriginalHeaderLine] = useState<string | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  // Reset state when dialog closes
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      // Cancel any in-progress matching
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setStep("upload");
      setPlaylistName("");
      setParsedTracks([]);
      setMatchedTracks([]);
      setMatchingProgress(0);
      setIsMatching(false);
      setOriginalFormat("m3u");
      setOriginalHeaderLine(undefined);
    }
    onOpenChange(open);
  };

  // Handle file selection
  const handleFileSelect = useCallback(async (file: File) => {
    try {
      const content = await file.text();
      const result = parsePlaylist(content, file.name);
      
      if (result.tracks.length === 0) {
        toast.error("No tracks found in the file");
        return;
      }
      
      setParsedTracks(result.tracks);
      setPlaylistName(file.name.replace(/\.[^.]+$/, ""));
      setOriginalFormat(result.format);
      setOriginalHeaderLine(result.headerLine);
      
      // Auto-start matching
      await matchTracks(result.tracks);
    } catch (error) {
      console.error("Failed to parse file:", error);
      toast.error("Failed to parse playlist file");
    }
  }, []);

  // Match tracks against library
  const matchTracks = async (tracks: ParsedTrack[]) => {
    // Cancel any previous matching operation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    // Create new abort controller for this operation
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    
    setIsMatching(true);
    setStep("matching");
    setMatchingProgress(0);
    
    const client = getClient();
    if (!client) {
      toast.error("Not connected to server");
      setIsMatching(false);
      return;
    }
    
    const matched: MatchedTrack[] = [];
    
    for (let i = 0; i < tracks.length; i++) {
      // Check if cancelled
      if (abortController.signal.aborted) {
        return;
      }
      
      const track = tracks[i];
      setMatchingProgress(Math.round(((i + 1) / tracks.length) * 100));
      
      // Build search query
      const searchParts: string[] = [];
      if (track.title) searchParts.push(track.title);
      if (track.artist) searchParts.push(track.artist);
      
      const query = searchParts.join(" ").trim();
      
      if (!query) {
        matched.push({ parsed: track, match: null, matchScore: 0 });
        continue;
      }
      
      try {
        const response = await client.search3({ query, songCount: 10 });
        
        // Check if cancelled after await
        if (abortController.signal.aborted) {
          return;
        }
        
        const songs = response.searchResult3?.song ?? [];
        
        // Find best match
        let bestMatch: Song | null = null;
        let bestScore = 0;
        
        for (const song of songs) {
          const score = calculateMatchScore(track, song);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = song;
          }
        }
        
        // Only accept matches above threshold
        if (bestScore >= 0.5) {
          matched.push({ parsed: track, match: bestMatch, matchScore: bestScore });
        } else {
          matched.push({ parsed: track, match: null, matchScore: 0 });
        }
      } catch (error) {
        // Check if this was an abort
        if (abortController.signal.aborted) {
          return;
        }
        console.error("Search error:", error);
        matched.push({ parsed: track, match: null, matchScore: 0 });
      }
      
      // Small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    // Only update state if not cancelled
    if (!abortController.signal.aborted) {
      setMatchedTracks(matched);
      setIsMatching(false);
      setStep("preview");
    }
  };

  // Calculate match score between parsed track and library song
  const calculateMatchScore = (parsed: ParsedTrack, song: Song): number => {
    let score = 0;
    let factors = 0;
    
    if (parsed.title && song.title) {
      const similarity = stringSimilarity(parsed.title, song.title);
      score += similarity * 2; // Title is weighted more
      factors += 2;
    }
    
    if (parsed.artist && song.artist) {
      const similarity = stringSimilarity(parsed.artist, song.artist);
      score += similarity;
      factors += 1;
    }
    
    if (parsed.album && song.album) {
      const similarity = stringSimilarity(parsed.album, song.album);
      score += similarity * 0.5;
      factors += 0.5;
    }
    
    return factors > 0 ? score / factors : 0;
  };

  // Simple string similarity (case-insensitive)
  const stringSimilarity = (a: string, b: string): number => {
    const aLower = a.toLowerCase().trim();
    const bLower = b.toLowerCase().trim();
    
    if (aLower === bLower) return 1;
    if (aLower.includes(bLower) || bLower.includes(aLower)) return 0.9;
    
    // Levenshtein-based similarity
    const maxLen = Math.max(aLower.length, bLower.length);
    if (maxLen === 0) return 1;
    
    const distance = levenshteinDistance(aLower, bLower);
    return 1 - distance / maxLen;
  };

  // Levenshtein distance
  const levenshteinDistance = (a: string, b: string): number => {
    const matrix: number[][] = [];
    
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[b.length][a.length];
  };

  // Create playlist mutation
  const createPlaylist = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      
      const matchedSongIds = matchedTracks
        .filter(t => t.match)
        .map(t => t.match!.id);
      
      if (matchedSongIds.length === 0) {
        throw new Error("No tracks to import");
      }
      
      // Create playlist with all matched songs
      // We need to create empty playlist first, then add songs
      const response = await client.createPlaylist({ name: playlistName.trim() });
      const playlistId = response.playlist?.id;
      
      if (!playlistId) {
        throw new Error("Failed to create playlist");
      }
      
      // Add songs to playlist
      await client.updatePlaylist({
        playlistId,
        songIdToAdd: matchedSongIds,
      });
      
      return { matchedCount: matchedSongIds.length };
    },
    onSuccess: async (data) => {
      toast.success(`Playlist "${playlistName}" created with ${data.matchedCount} songs`);
      await queryClient.invalidateQueries({ queryKey: ["playlists"] });
      handleOpenChange(false);
    },
    onError: (error) => {
      toast.error(`Failed to create playlist: ${error instanceof Error ? error.message : "Unknown error"}`);
    },
  });

  // Download unmatched tracks in the same format as the original file
  const downloadUnmatched = () => {
    const unmatched = matchedTracks.filter(t => !t.match);
    if (unmatched.length === 0) return;
    
    // Export using the original format
    const content = exportOriginalLines(
      unmatched.map(t => t.parsed),
      originalFormat,
      originalHeaderLine
    );
    
    const mimeType = getFormatMimeType(originalFormat);
    const extension = getFormatExtension(originalFormat);
    
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${playlistName}_unmatched${extension}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Handle drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const matchedCount = matchedTracks.filter(t => t.match).length;
  const unmatchedCount = matchedTracks.filter(t => !t.match).length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Import Playlist
          </DialogTitle>
          <DialogDescription>
            Import a playlist from M3U, PLS, or CSV file. Tracks will be matched against your library.
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
              isDragging ? "border-primary bg-primary/10" : "border-muted-foreground/25"
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".m3u,.m3u8,.pls,.csv,.txt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
            />
            <FileMusic className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-lg font-medium mb-1">Drop your playlist file here</p>
            <p className="text-sm text-muted-foreground mb-4">
              Supports M3U, M3U8, PLS, and CSV formats
            </p>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              Browse Files
            </Button>
          </div>
        )}

        {step === "matching" && (
          <div className="py-8 text-center">
            <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-primary" />
            <p className="text-lg font-medium mb-2">Matching tracks...</p>
            <p className="text-sm text-muted-foreground mb-4">
              Searching your library for {parsedTracks.length} tracks
            </p>
            <Progress value={matchingProgress} className="w-full" />
            <p className="text-sm text-muted-foreground mt-2">{matchingProgress}%</p>
          </div>
        )}

        {step === "preview" && (
          <>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="import-name">Playlist Name</Label>
                <Input
                  id="import-name"
                  value={playlistName}
                  onChange={(e) => setPlaylistName(e.target.value)}
                  placeholder="My Imported Playlist"
                />
              </div>
              
              {/* Match summary */}
              <div className="flex gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="default" className="bg-green-500">
                    <Check className="w-3 h-3 mr-1" />
                    {matchedCount} matched
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="secondary" className="bg-orange-500/20 text-orange-500">
                    <AlertCircle className="w-3 h-3 mr-1" />
                    {unmatchedCount} not found
                  </Badge>
                </div>
              </div>
            </div>

            {/* Track list */}
            <Tabs defaultValue={unmatchedCount > 0 ? "all" : "matched"} className="flex-1 min-h-0">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="all">All ({matchedTracks.length})</TabsTrigger>
                <TabsTrigger value="matched">Matched ({matchedCount})</TabsTrigger>
                <TabsTrigger value="unmatched">Not Found ({unmatchedCount})</TabsTrigger>
              </TabsList>
              
              <TabsContent value="all" className="flex-1 mt-2">
                <TrackList 
                  tracks={matchedTracks} 
                  onUpdateMatch={(index, match, score) => {
                    setMatchedTracks(prev => {
                      const updated = [...prev];
                      updated[index] = { ...updated[index], match, matchScore: score };
                      return updated;
                    });
                  }}
                />
              </TabsContent>
              <TabsContent value="matched" className="flex-1 mt-2">
                <TrackList 
                  tracks={matchedTracks.filter(t => t.match)} 
                  onUpdateMatch={(index, match, score) => {
                    // Find the original index in matchedTracks
                    const matchedOnly = matchedTracks.filter(t => t.match);
                    const originalIndex = matchedTracks.findIndex(t => t === matchedOnly[index]);
                    if (originalIndex !== -1) {
                      setMatchedTracks(prev => {
                        const updated = [...prev];
                        updated[originalIndex] = { ...updated[originalIndex], match, matchScore: score };
                        return updated;
                      });
                    }
                  }}
                />
              </TabsContent>
              <TabsContent value="unmatched" className="flex-1 mt-2">
                <TrackList 
                  tracks={matchedTracks.filter(t => !t.match)} 
                  onUpdateMatch={(index, match, score) => {
                    // Find the original index in matchedTracks
                    const unmatchedOnly = matchedTracks.filter(t => !t.match);
                    const originalIndex = matchedTracks.findIndex(t => t === unmatchedOnly[index]);
                    if (originalIndex !== -1) {
                      setMatchedTracks(prev => {
                        const updated = [...prev];
                        updated[originalIndex] = { ...updated[originalIndex], match, matchScore: score };
                        return updated;
                      });
                    }
                  }}
                />
              </TabsContent>
            </Tabs>
          </>
        )}

        {step === "importing" && (
          <div className="py-8 text-center">
            <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-primary" />
            <p className="text-lg font-medium">Creating playlist...</p>
          </div>
        )}

        <DialogFooter className="shrink-0">
          {step === "preview" && unmatchedCount > 0 && (
            <Button variant="outline" className="mr-auto" onClick={downloadUnmatched}>
              <Download className="w-4 h-4 mr-2" />
              Download Unmatched
            </Button>
          )}
          
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          
          {step === "preview" && (
            <Button
              onClick={() => {
                setStep("importing");
                createPlaylist.mutate();
              }}
              disabled={!playlistName.trim() || matchedCount === 0 || createPlaylist.isPending}
            >
              {createPlaylist.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>Import {matchedCount} Tracks</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TrackList({ 
  tracks, 
  onUpdateMatch,
}: { 
  tracks: MatchedTrack[];
  onUpdateMatch: (index: number, match: Song | null, score: number) => void;
}) {
  if (tracks.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Music className="w-6 h-6 mr-2" />
        No tracks
      </div>
    );
  }

  return (
    <ScrollArea className="h-[300px] rounded-md border">
      <div className="p-2">
        {tracks.map((track, index) => (
          <TrackRow 
            key={index}
            track={track}
            index={index}
            onUpdateMatch={onUpdateMatch}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

function TrackRow({
  track,
  index,
  onUpdateMatch,
}: {
  track: MatchedTrack;
  index: number;
  onUpdateMatch: (index: number, match: Song | null, score: number) => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    try {
      const client = getClient();
      if (!client) return;
      
      const response = await client.search3({ query: searchQuery.trim(), songCount: 20 });
      setSearchResults(response.searchResult3?.song ?? []);
    } catch (error) {
      console.error("Search error:", error);
      toast.error("Search failed");
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectMatch = (song: Song) => {
    onUpdateMatch(index, song, 1); // Manual selection = 100% match
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
  };

  const handleClearMatch = () => {
    onUpdateMatch(index, null, 0);
    setSearchOpen(false);
  };

  // Initialize search query with parsed track info
  const openSearch = () => {
    const parts: string[] = [];
    if (track.parsed.artist) parts.push(track.parsed.artist);
    if (track.parsed.title) parts.push(track.parsed.title);
    setSearchQuery(parts.join(" ").trim() || track.parsed.raw);
    setSearchResults([]);
    setSearchOpen(true);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-2 rounded-md group",
        track.match ? "hover:bg-accent/50" : "bg-orange-500/10"
      )}
    >
      <div className="shrink-0">
        {track.match ? (
          <Check className="w-4 h-4 text-green-500" />
        ) : (
          <X className="w-4 h-4 text-orange-500" />
        )}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">
            {track.parsed.artist 
              ? `${track.parsed.artist} - ${track.parsed.title || track.parsed.raw}`
              : track.parsed.title || track.parsed.raw
            }
          </span>
          {track.matchScore > 0 && track.matchScore < 1 && (
            <Badge variant="outline" className="text-xs shrink-0">
              {Math.round(track.matchScore * 100)}%
            </Badge>
          )}
        </div>
      </div>
      
      {track.match && (
        <div className="text-right text-sm text-muted-foreground truncate max-w-[200px]">
          <span className="text-xs">→</span>{" "}
          {track.match.artist 
            ? `${track.match.artist} - ${track.match.title}`
            : track.match.title
          }
        </div>
      )}

      <Popover open={searchOpen} onOpenChange={setSearchOpen}>
        <PopoverTrigger asChild>
          <Button 
            variant="ghost" 
            size="icon" 
            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7"
            onClick={openSearch}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-3" align="end">
          <div className="space-y-3">
            <div className="font-medium text-sm">Find alternative match</div>
            
            <div className="flex gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search for track..."
                className="h-8"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSearch();
                  }
                }}
              />
              <Button 
                size="sm" 
                onClick={handleSearch}
                disabled={isSearching || !searchQuery.trim()}
                className="h-8"
              >
                {isSearching ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
              </Button>
            </div>

            {searchResults.length > 0 && (
              <div 
                className="h-[200px] rounded border overflow-y-auto"
                onWheel={(e) => {
                  // Prevent popover from capturing wheel events
                  e.stopPropagation();
                }}
              >
                <div className="p-1">
                  {searchResults.map((song) => (
                    <button
                      key={song.id}
                      className="w-full text-left p-2 rounded hover:bg-accent text-sm flex items-center gap-2"
                      onClick={() => handleSelectMatch(song)}
                    >
                      <Music className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{song.title}</div>
                        <div className="text-muted-foreground text-xs truncate">
                          {song.artist}{song.album ? ` • ${song.album}` : ""}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {searchResults.length === 0 && searchQuery && !isSearching && (
              <div className="text-sm text-muted-foreground text-center py-4">
                Press Enter or click Search to find tracks
              </div>
            )}

            {track.match && (
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full"
                onClick={handleClearMatch}
              >
                <X className="w-3.5 h-3.5 mr-2" />
                Remove match
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
