"use client";

import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { motion } from "framer-motion";
import { Folder, ChevronRight, Home } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { useAuth } from "@/lib/hooks/use-auth";
import { isConnectedAtom } from "@/lib/store/auth";
import { getClient } from "@/lib/api/client";
import { Skeleton } from "@/components/ui/skeleton";
import { CoverImage } from "@/components/shared/cover-image";
import type { DirectoryChild } from "@/lib/api/types";
import { cn } from "@/lib/utils";

function FilesPageContent() {
  const searchParams = useSearchParams();
  const directoryId = searchParams.get("id");
  
  const { isReady } = useAuth({ redirectToLogin: true });
  const isConnected = useAtomValue(isConnectedAtom);

  // Fetch indexes (top-level artist listing) when no directory is selected
  const { data: indexes, isLoading: indexesLoading } = useQuery({
    queryKey: ["indexes"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getIndexes();
    },
    enabled: isReady && isConnected && !directoryId,
    staleTime: 60 * 1000,
  });

  // Fetch directory contents when a directory is selected
  const { data: directory, isLoading: directoryLoading } = useQuery({
    queryKey: ["directory", directoryId],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getMusicDirectory(directoryId!);
    },
    enabled: isReady && isConnected && !!directoryId,
    staleTime: 60 * 1000,
  });

  const isLoading = indexesLoading || directoryLoading;

  // Build breadcrumb navigation
  const breadcrumbs = [];
  if (directoryId) {
    breadcrumbs.push({ label: "Files", href: "/library/files" });
    if (directory) {
      // Add parent directories if available
      // For now, just show the current directory name
      breadcrumbs.push({ label: directory.directory.name, href: null });
    }
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="px-4 lg:px-6 pt-8 pb-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3"
        >
          <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
            <Folder className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">
              {directoryId && directory ? directory.directory.name : "Browse Files"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {directoryId 
                ? "Explore directory contents"
                : "Browse your music library by folder structure"
              }
            </p>
          </div>
        </motion.div>

        {/* Breadcrumbs */}
        {breadcrumbs.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-1 mt-4 text-sm text-muted-foreground"
          >
            <Link 
              href="/library/files" 
              className="flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <Home className="w-4 h-4" />
              <span>Files</span>
            </Link>
            {directory?.directory.parent && (
              <>
                <ChevronRight className="w-4 h-4" />
                <Link 
                  href={`/library/files?id=${encodeURIComponent(directory.directory.parent)}`}
                  className="hover:text-foreground transition-colors"
                >
                  ...
                </Link>
              </>
            )}
            {directory && (
              <>
                <ChevronRight className="w-4 h-4" />
                <span className="text-foreground">{directory.directory.name}</span>
              </>
            )}
          </motion.div>
        )}
      </div>

      {/* Content */}
      <div className="px-4 lg:px-6 pb-24">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : directoryId && directory ? (
          // Directory contents view
          <DirectoryContents items={directory.directory.child} />
        ) : indexes ? (
          // Indexes view (top-level artist listing)
          <IndexesView indexes={indexes} />
        ) : null}
      </div>
    </div>
  );
}

// Indexes view showing artists grouped by letter
function IndexesView({ indexes }: { indexes: { indexes: { index: Array<{ name: string; artist: Array<{ id: string; name: string }> }> } } }) {
  return (
    <div className="space-y-6">
      {indexes.indexes.index.map((indexGroup) => (
        <div key={indexGroup.name}>
          <h2 className="text-lg font-semibold mb-3 text-muted-foreground">
            {indexGroup.name}
          </h2>
          <div className="grid gap-2">
            {indexGroup.artist.map((artist) => (
              <Link
                key={artist.id}
                href={`/library/files?id=${encodeURIComponent(artist.id)}`}
              >
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg",
                    "hover:bg-muted/50 transition-colors cursor-pointer group"
                  )}
                >
                  <CoverImage
                    src={null}
                    alt={artist.name}
                    colorSeed={artist.name}
                    type="artist"
                    size="sm"
                    className="rounded"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{artist.name}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </motion.div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Directory contents view
function DirectoryContents({ items }: { items: DirectoryChild[] }) {
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Folder className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>This directory is empty</p>
      </div>
    );
  }

  // Separate directories and files
  const directories = items.filter((item) => item.isDir);
  const files = items.filter((item) => !item.isDir);
  
  // Helper to get cover art URL
  const getCoverUrl = (coverArt: string | null) => {
    if (!coverArt) return null;
    const client = getClient();
    return client?.getCoverArtUrl(coverArt, 100) ?? null;
  };

  return (
    <div className="space-y-4">
      {/* Directories */}
      {directories.length > 0 && (
        <div className="space-y-2">
          {directories.map((item, index) => (
            <Link
              key={item.id}
              href={`/library/files?id=${encodeURIComponent(item.id)}`}
            >
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.02 }}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg",
                  "hover:bg-muted/50 transition-colors cursor-pointer group"
                )}
              >
                <CoverImage
                  src={getCoverUrl(item.coverArt)}
                  alt={item.title}
                  colorSeed={item.title}
                  type="album"
                  size="md"
                  className="rounded"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{item.title}</p>
                  {item.artist && (
                    <p className="text-sm text-muted-foreground truncate">{item.artist}</p>
                  )}
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </motion.div>
            </Link>
          ))}
        </div>
      )}

      {/* Files (songs) */}
      {files.length > 0 && (
        <div className="space-y-2">
          {directories.length > 0 && (
            <h3 className="text-sm font-medium text-muted-foreground mt-6 mb-2">
              Songs
            </h3>
          )}
          {files.map((item, index) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: (directories.length + index) * 0.02 }}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg",
                "hover:bg-muted/50 transition-colors cursor-pointer group"
              )}
            >
              <CoverImage
                src={getCoverUrl(item.coverArt)}
                alt={item.title}
                colorSeed={item.title}
                type="song"
                size="md"
                className="rounded"
              />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{item.title}</p>
                <p className="text-sm text-muted-foreground truncate">
                  {[item.artist, item.album].filter(Boolean).join(" • ")}
                </p>
              </div>
              {item.duration && (
                <span className="text-sm text-muted-foreground">
                  {formatDuration(item.duration)}
                </span>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// Helper function to format duration
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function FilesPage() {
  return (
    <Suspense fallback={
      <div className="p-4 lg:p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </div>
    }>
      <FilesPageContent />
    </Suspense>
  );
}
