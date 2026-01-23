"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSetAtom } from "jotai";
import {
  Upload,
  ListMusic,
  Heart,
  BarChart3,
  Tag,
  Music,
  ChevronRight,
  FileSpreadsheet,
  Folder,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/lib/hooks/use-auth";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { ImportPlaylistDialog } from "@/components/playlists/import-playlist-dialog";
import { ImportFavoritesDialog } from "@/components/stats/import-favorites-dialog";
import { ImportPlayCountsDialog } from "@/components/stats/import-play-counts-dialog";
import {
  scanDialogOpenAtom,
  scanFolderIdAtom,
  scanFolderNameAtom,
} from "@/lib/store/scan";

/**
 * Import Page - Hub for discovering and accessing import functionality
 *
 * This page helps users discover all the ways they can import data into Ferrotune:
 * - Upload new music via the Tag Editor
 * - Import playlists from CSV/text files
 * - Import favorites from CSV files
 * - Import play counts/scrobbles
 */
export default function ImportPage() {
  useAuth({ redirectToLogin: true });
  const router = useRouter();
  const { isAdmin } = useCurrentUser();
  const setScanDialogOpen = useSetAtom(scanDialogOpenAtom);
  const setScanFolderId = useSetAtom(scanFolderIdAtom);
  const setScanFolderName = useSetAtom(scanFolderNameAtom);

  const [playlistDialogOpen, setPlaylistDialogOpen] = useState(false);
  const [favoritesDialogOpen, setFavoritesDialogOpen] = useState(false);
  const [playCountsDialogOpen, setPlayCountsDialogOpen] = useState(false);

  // Helper to open scanner for all libraries
  const openFullScan = () => {
    setScanFolderId(null);
    setScanFolderName(null);
    setScanDialogOpen(true);
  };

  return (
    <div className="container max-w-4xl py-8 px-4 space-y-4">
      {/* Header */}
      <div className="space-y-2 pb-4">
        <h1 className="text-3xl font-bold tracking-tight">Import & Manage</h1>
        <p className="text-muted-foreground">
          Upload new music, import playlists, favorites, and play data into your
          library.
        </p>
      </div>

      {/* Import Cards Grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Tag Editor / Tagger - First & Most Prominent */}
        <Card
          className="hover:border-primary/50 transition-colors cursor-pointer group border-primary/30 bg-primary/5"
          onClick={() => router.push("/tagger")}
        >
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/20 rounded-lg">
                <Upload className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">Import & Manage Music</CardTitle>
                <CardDescription>
                  Add and organize tracks in your library
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col flex-1 space-y-3 gap-3">
            <p className="text-sm text-muted-foreground">
              Upload audio files to add them to your library. Edit metadata,
              organize files with rename scripts, and save changes to your music
              folder.
            </p>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li className="flex items-center gap-2">
                <Upload className="w-4 h-4" />
                Drag and drop audio files
              </li>
              <li className="flex items-center gap-2">
                <Tag className="w-4 h-4" />
                Bulk edit metadata in spreadsheet view
              </li>
              <li className="flex items-center gap-2">
                <Folder className="w-4 h-4" />
                Organize with rename scripts
              </li>
            </ul>
            <Link href="/tagger" className="mt-auto">
              <Button className="w-full group-hover:bg-primary/90">
                Open Tag Editor
                <ChevronRight className="w-4 h-4 ml-auto" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Import Playlists */}
        <Card
          className="hover:border-primary/50 transition-colors cursor-pointer group"
          onClick={() => setPlaylistDialogOpen(true)}
        >
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-violet-500/10 rounded-lg">
                <ListMusic className="w-5 h-5 text-violet-500" />
              </div>
              <div>
                <CardTitle className="text-lg">Import Playlists</CardTitle>
                <CardDescription>From CSV or text files</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col flex-1 space-y-3 gap-3">
            <p className="text-sm text-muted-foreground">
              Import playlist track lists from CSV, TXT, or tab-separated files.
              Ferrotune will match tracks against your library and create a new
              playlist.
            </p>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4" />
                Supports CSV, TXT, TSV formats
              </li>
              <li className="flex items-center gap-2">
                <Music className="w-4 h-4" />
                Automatic track matching
              </li>
              <li className="flex items-center gap-2">
                <Heart className="w-4 h-4" />
                Manual match review
              </li>
            </ul>
            <Button
              variant="outline"
              className="w-full mt-auto group-hover:border-violet-500/50"
              onClick={() => setPlaylistDialogOpen(true)}
            >
              Import Playlist
              <ChevronRight className="w-4 h-4 ml-auto" />
            </Button>
          </CardContent>
        </Card>

        {/* Import Favorites */}
        <Card
          className="hover:border-primary/50 transition-colors cursor-pointer group"
          onClick={() => setFavoritesDialogOpen(true)}
        >
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-rose-500/10 rounded-lg">
                <Heart className="w-5 h-5 text-rose-500" />
              </div>
              <div>
                <CardTitle className="text-lg">Import Favorites</CardTitle>
                <CardDescription>Songs, albums, and artists</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col flex-1 space-y-3 gap-3">
            <p className="text-sm text-muted-foreground">
              Import your liked songs, favorite albums, and artists from a CSV
              file. Great for migrating from other streaming services.
            </p>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4" />
                Supports CSV format
              </li>
              <li className="flex items-center gap-2">
                <Music className="w-4 h-4" />
                Songs, albums, and artists
              </li>
            </ul>
            <Button
              variant="outline"
              className="w-full mt-auto group-hover:border-rose-500/50"
              onClick={() => setFavoritesDialogOpen(true)}
            >
              Import Favorites
              <ChevronRight className="w-4 h-4 ml-auto" />
            </Button>
          </CardContent>
        </Card>

        {/* Import Play Counts */}
        <Card
          className="hover:border-primary/50 transition-colors cursor-pointer group"
          onClick={() => setPlayCountsDialogOpen(true)}
        >
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/10 rounded-lg">
                <BarChart3 className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <CardTitle className="text-lg">Import Play Counts</CardTitle>
                <CardDescription>From scrobble history</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col flex-1 space-y-3 gap-3">
            <p className="text-sm text-muted-foreground">
              Import play counts from scrobble history or streaming service
              exports. Preserves your listening statistics and enables smart
              playlist features.
            </p>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4" />
                Supports CSV and JSON imports
              </li>
              <li className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Streaming history imports
              </li>
            </ul>
            <Button
              variant="outline"
              className="w-full mt-auto group-hover:border-amber-500/50"
              onClick={() => setPlayCountsDialogOpen(true)}
            >
              Import Play Counts
              <ChevronRight className="w-4 h-4 ml-auto" />
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Admin Quick Links - Scanner & Recycle Bin */}
      {isAdmin && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Scanner Card */}
          <Card
            className="hover:border-primary/50 transition-colors cursor-pointer group"
            onClick={openFullScan}
          >
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <RefreshCw className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Library Scanner</CardTitle>
                  <CardDescription>
                    Scan for new and changed files
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Recycle Bin Card */}
          <Link href="/admin/recycle-bin">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer group h-full">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-destructive/10 rounded-lg">
                    <Trash2 className="w-5 h-5 text-destructive" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Recycle Bin</CardTitle>
                    <CardDescription>
                      Manage files marked for deletion
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>
          </Link>
        </div>
      )}

      {/* Dialogs */}
      <ImportPlaylistDialog
        open={playlistDialogOpen}
        onOpenChange={setPlaylistDialogOpen}
      />
      <ImportFavoritesDialog
        open={favoritesDialogOpen}
        onOpenChange={setFavoritesDialogOpen}
      />
      <ImportPlayCountsDialog
        open={playCountsDialogOpen}
        onOpenChange={setPlayCountsDialogOpen}
      />
    </div>
  );
}
