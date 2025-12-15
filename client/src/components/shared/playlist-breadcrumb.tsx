"use client";

import { useRouter } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";

interface PlaylistBreadcrumbProps {
  /**
   * The full playlist name including folder path (e.g., "Folder/SubFolder/PlaylistName")
   */
  playlistName?: string;
}

/**
 * Shared breadcrumb component for playlist details views.
 * Parses the playlist name and renders clickable breadcrumbs for folder navigation.
 */
export function PlaylistBreadcrumb({ playlistName }: PlaylistBreadcrumbProps) {
  const router = useRouter();

  // Build breadcrumb items from playlist name (which includes folder path)
  const breadcrumbItems = (() => {
    const items: { label: string; path: string }[] = [
      { label: "Playlists", path: "" },
    ];
    if (!playlistName) return items;

    // Playlist names include the full path like "Folder/SubFolder/PlaylistName"
    const parts = playlistName.split("/");

    // If there's only one part, there's no folder, just the playlist name
    if (parts.length <= 1) return items;

    // Build folder breadcrumbs (all parts except the last, which is the playlist name)
    let currentPath = "";
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      items.push({ label: parts[i], path: currentPath });
    }

    return items;
  })();

  // Get the display name (last part of the path)
  const displayName = (() => {
    if (!playlistName) return "Playlist";
    const parts = playlistName.split("/");
    return parts[parts.length - 1];
  })();

  // Navigate to a folder
  const navigateToFolder = (path: string) => {
    if (path === "") {
      router.push("/playlists");
    } else {
      router.push(`/playlists?folder=${encodeURIComponent(path)}`);
    }
  };

  // Don't render if playlist is not in a folder
  if (breadcrumbItems.length <= 1) {
    return null;
  }

  return (
    <div className="relative z-20 px-4 lg:px-6 py-2 flex items-center gap-1 text-sm text-muted-foreground border-b border-border bg-background/80 backdrop-blur-sm">
      {breadcrumbItems.map((item, index) => (
        <div key={item.path} className="flex items-center">
          {index > 0 && <ChevronRight className="w-4 h-4 mx-1" />}
          <button
            onClick={() => navigateToFolder(item.path)}
            className="hover:text-foreground transition-colors px-1 py-0.5 rounded hover:bg-accent"
          >
            {index === 0 ? <Home className="w-4 h-4" /> : item.label}
          </button>
        </div>
      ))}
      <ChevronRight className="w-4 h-4 mx-1" />
      <span className="font-medium text-foreground">{displayName}</span>
    </div>
  );
}

/**
 * Get the display name from a full playlist path.
 * e.g., "Folder/SubFolder/PlaylistName" -> "PlaylistName"
 */
export function getPlaylistDisplayName(playlistName?: string): string {
  if (!playlistName) return "Playlist";
  const parts = playlistName.split("/");
  return parts[parts.length - 1];
}
