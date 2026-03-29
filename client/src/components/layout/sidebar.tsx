"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Home,
  Search,
  Library,
  ListMusic,
  Heart,
  History,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Settings,
  Folder,
  FolderOpen,
  Disc,
  Users,
  Music,
  Tag,
  Import,
  Play,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  sidebarCollapsedAtom,
  sidebarWidthAtom,
  playlistsSidebarExpandedAtom,
  librarySidebarExpandedAtom,
  expandedPlaylistFoldersAtom,
  sidebarItemSizeAtom,
  type SidebarItemSize,
} from "@/lib/store/ui";
import { isConnectedAtom } from "@/lib/store/auth";
import { getClient } from "@/lib/api/client";
import { ScanStatusIndicator } from "@/components/admin/scan-status-indicator";
import { ScanDialog } from "@/components/admin/scan-dialog";
import { CoverImage } from "@/components/shared/cover-image";
import { UserSwitcher } from "@/components/layout/user-switcher";
import {
  organizePlaylistsIntoFolders,
  buildFolderTreeFromApi,
  getPlaylistDisplayName,
  parsePlaylistPath,
  type PlaylistFolder,
} from "@/lib/utils/playlist-folders";
import { startQueueAtom } from "@/lib/store/server-queue";
import { PlaylistContextMenu } from "@/components/playlists/playlist-context-menu";
import { SmartPlaylistContextMenu } from "@/components/playlists/smart-playlist-context-menu";
import type { Playlist, SmartPlaylist } from "@/lib/api/types";

// Height classes for sidebar list items
const SIDEBAR_ITEM_HEIGHTS: Record<SidebarItemSize, string> = {
  small: "h-7",
  medium: "h-9",
  large: "h-11",
};

// Icon container sizes for sidebar list items (matches cover sizes for consistency)
const SIDEBAR_ICON_CONTAINER_SIZES: Record<SidebarItemSize, string> = {
  small: "w-4 h-4",
  medium: "w-7 h-7",
  large: "w-10 h-10",
};

// Icon sizes within the container (smaller than container)
const SIDEBAR_ICON_SIZES: Record<SidebarItemSize, string> = {
  small: "w-3 h-3",
  medium: "w-4 h-4",
  large: "w-5 h-5",
};

// Cover image sizes for sidebar list items
const SIDEBAR_COVER_SIZES: Record<SidebarItemSize, string> = {
  small: "w-4 h-4",
  medium: "w-7 h-7",
  large: "w-10 h-10",
};

const discoverItems = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/search", icon: Search, label: "Search" },
];

const librarySubItems = [
  { href: "/library/albums", icon: Disc, label: "Albums" },
  { href: "/library/artists", icon: Users, label: "Artists" },
  { href: "/library/songs", icon: Music, label: "Songs" },
  { href: "/library/genres", icon: Tag, label: "Genres" },
  { href: "/library/files", icon: Folder, label: "Files" },
];

export function Sidebar() {
  const pathname = usePathname();
  const hydrated = useHydrated();
  const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom);
  const sidebarWidth = useAtomValue(sidebarWidthAtom);
  const isConnected = useAtomValue(isConnectedAtom);
  const itemSize = useAtomValue(sidebarItemSizeAtom);
  const [playlistsExpanded, setPlaylistsExpanded] = useAtom(
    playlistsSidebarExpandedAtom,
  );
  const [libraryExpanded, setLibraryExpanded] = useAtom(
    librarySidebarExpandedAtom,
  );
  const [expandedFolders, setExpandedFolders] = useAtom(
    expandedPlaylistFoldersAtom,
  );

  // Compute height and icon classes based on item size
  const itemHeight = SIDEBAR_ITEM_HEIGHTS[itemSize];
  const iconContainerSize = SIDEBAR_ICON_CONTAINER_SIZES[itemSize];
  const iconSize = SIDEBAR_ICON_SIZES[itemSize];
  const coverSize = SIDEBAR_COVER_SIZES[itemSize];

  // Fetch playlist folders from new API
  const { data: playlistFoldersData, isLoading: playlistsLoading } = useQuery({
    queryKey: ["playlistFolders"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getPlaylistFoldersWithStructure();
    },
    enabled: isConnected,
  });

  // Fetch smart playlists
  const { data: smartPlaylists } = useQuery({
    queryKey: ["smartPlaylists"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getSmartPlaylists();
      return response.smartPlaylists ?? [];
    },
    enabled: isConnected,
  });

  // Build folder tree from API data
  // Use the new API-based folder tree if we have folder entities,
  // otherwise fall back to the legacy name-based parsing
  const playlistTree = playlistFoldersData
    ? playlistFoldersData.folders.length > 0 ||
      playlistFoldersData.playlists.some((p) => p.folderId)
      ? buildFolderTreeFromApi(
          playlistFoldersData.folders,
          playlistFoldersData.playlists,
          smartPlaylists,
        )
      : organizePlaylistsIntoFolders(
          playlistFoldersData.playlists.map((p) => ({
            id: p.id,
            name: p.name,
            comment: null,
            owner: "admin",
            public: false,
            songCount: p.songCount,
            duration: 0,
            created: new Date().toISOString(),
            changed: new Date().toISOString(),
            coverArt: null,
          })),
          smartPlaylists,
        )
    : null;

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
    );
  };

  // Queue management for sidebar play buttons
  const startQueue = useSetAtom(startQueueAtom);

  // Play regular playlist handler
  const handlePlayPlaylist = (playlist: Playlist) => {
    startQueue({
      sourceType: "playlist",
      sourceId: playlist.id,
      sourceName: getPlaylistDisplayName(playlist),
    });
  };

  // Play smart playlist handler
  const handlePlaySmartPlaylist = async (id: string, name: string) => {
    const client = getClient();
    if (!client) return;
    try {
      const response = await client.getSmartPlaylistSongs(id);
      if (response.songs.length === 0) {
        toast.info("Smart playlist has no matching songs");
        return;
      }
      startQueue({
        sourceType: "other",
        sourceName: `Smart: ${name}`,
        songIds: response.songs.map((s) => s.id),
      });
    } catch (error) {
      toast.error("Failed to play smart playlist");
      console.error(error);
    }
  };

  // Update CSS variable when collapsed state changes (after hydration)
  useEffect(() => {
    if (!hydrated) return;
    const width = collapsed ? 72 : sidebarWidth;
    document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
  }, [hydrated, collapsed, sidebarWidth]);

  // Don't show sidebar on login page
  if (pathname === "/login") {
    return null;
  }

  // Before hydration, assume expanded state (default). After hydration, use actual state.
  // This ensures SSR renders a full sidebar while client can show collapsed if stored in localStorage.
  const isCollapsed = hydrated && collapsed;
  // Before hydration, assume connected (show full nav). After hydration, use actual state.
  const showConnectedState = !hydrated || isConnected;

  // Use motion.aside after hydration for smooth collapse animation, static aside during SSR
  const AsideComponent = hydrated ? motion.aside : "aside";
  const asideProps = hydrated
    ? {
        initial: false,
        animate: { width: isCollapsed ? 72 : sidebarWidth },
        transition: { duration: 0.2, ease: "easeInOut" as const },
      }
    : { style: { width: "var(--sidebar-width)" } };

  return (
    <AsideComponent
      {...asideProps}
      className={cn(
        "hidden lg:flex flex-col bg-sidebar border-r border-sidebar-border overflow-hidden shrink-0",
      )}
    >
      {/* Logo */}
      <div className="flex items-center justify-between h-16 px-4 overflow-hidden shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 shrink-0 rounded-lg bg-primary">
            <Music className="w-6 h-6 text-primary-foreground" />
          </div>
          {!isCollapsed &&
            (hydrated ? (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="font-bold text-xl text-foreground whitespace-nowrap"
              >
                Ferrotune
              </motion.span>
            ) : (
              <span className="font-bold text-xl text-foreground whitespace-nowrap">
                Ferrotune
              </span>
            ))}
        </div>
        {/* Scan Status Indicator - only after hydration when connected */}
        {hydrated && isConnected && (
          <TooltipProvider>
            <ScanStatusIndicator collapsed={isCollapsed} />
          </TooltipProvider>
        )}
      </div>

      {/* Scan Dialog - rendered once, controlled by atom */}
      {hydrated && <ScanDialog />}

      {/* Scrollable content - wraps nav and library section */}
      <ScrollArea className="flex-1 min-h-0">
        {/* Discover Section */}
        <nav className="px-2 py-4">
          {!isCollapsed && (
            <div className="px-2 mb-2 overflow-hidden">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                Discover
              </span>
            </div>
          )}
          <div className="space-y-1">
            {discoverItems.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);

              return (
                <Link key={item.href} href={item.href}>
                  <Button
                    variant="ghost"
                    className={cn(
                      "w-full justify-start gap-4 h-10 px-3 overflow-hidden",
                      "hover:bg-sidebar-accent",
                      isActive &&
                        "bg-sidebar-accent text-sidebar-primary font-semibold",
                      isCollapsed && "justify-center px-0",
                    )}
                  >
                    <item.icon
                      className={cn(
                        "w-5 h-5 shrink-0",
                        isActive && "text-sidebar-primary",
                      )}
                    />
                    {!isCollapsed && (
                      <span className="truncate whitespace-nowrap">
                        {item.label}
                      </span>
                    )}
                  </Button>
                </Link>
              );
            })}
          </div>
        </nav>

        <Separator className="mx-2 bg-sidebar-border" />

        {/* Your Library Section */}
        <div className="py-4">
          {!isCollapsed && (
            <div className="px-4 mb-2 overflow-hidden">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                Your Library
              </span>
            </div>
          )}

          <div className="px-2 space-y-1">
            {/* Library - Expandable */}
            {!isCollapsed && showConnectedState && (
              <>
                {hydrated && isConnected ? (
                  <Collapsible
                    open={libraryExpanded}
                    onOpenChange={setLibraryExpanded}
                  >
                    <div className="relative">
                      <Link href="/library" className="block">
                        <Button
                          variant="ghost"
                          className={cn(
                            "w-full justify-start gap-4 h-10 px-3 pr-10 overflow-hidden",
                            "hover:bg-sidebar-accent",
                            pathname.startsWith("/library") &&
                              "bg-sidebar-accent text-sidebar-primary font-semibold",
                          )}
                        >
                          <Library
                            className={cn(
                              "w-5 h-5 shrink-0",
                              pathname.startsWith("/library") &&
                                "text-sidebar-primary",
                            )}
                          />
                          <span className="truncate whitespace-nowrap flex-1 text-left">
                            Library
                          </span>
                        </Button>
                      </Link>
                      <CollapsibleTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8",
                            "hover:bg-sidebar-accent/80",
                          )}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ChevronDown
                            className={cn(
                              "w-4 h-4 shrink-0 transition-transform duration-200",
                              libraryExpanded && "rotate-180",
                            )}
                          />
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                    <CollapsibleContent>
                      <div className="pl-4 mt-1 space-y-0.5">
                        {librarySubItems.map((subItem) => {
                          const isSubActive = pathname === subItem.href;
                          return (
                            <Link key={subItem.href} href={subItem.href}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className={cn(
                                  "w-full justify-start gap-2 h-8 px-2 hover:bg-sidebar-accent",
                                  isSubActive &&
                                    "bg-sidebar-accent text-sidebar-primary",
                                )}
                              >
                                <subItem.icon className="w-4 h-4 shrink-0 text-muted-foreground" />
                                <span className="truncate text-sm">
                                  {subItem.label}
                                </span>
                              </Button>
                            </Link>
                          );
                        })}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                ) : (
                  /* During SSR, show expanded Library with subitems (default state) */
                  <>
                    <Link href="/library">
                      <Button
                        variant="ghost"
                        className={cn(
                          "w-full justify-start gap-4 h-10 px-3 overflow-hidden",
                          "hover:bg-sidebar-accent",
                          pathname.startsWith("/library") &&
                            "bg-sidebar-accent text-sidebar-primary font-semibold",
                        )}
                      >
                        <Library
                          className={cn(
                            "w-5 h-5 shrink-0",
                            pathname.startsWith("/library") &&
                              "text-sidebar-primary",
                          )}
                        />
                        <span className="truncate whitespace-nowrap">
                          Library
                        </span>
                      </Button>
                    </Link>
                    <div className="pl-4 mt-1 space-y-0.5">
                      {librarySubItems.map((subItem) => {
                        const isSubActive = pathname === subItem.href;
                        return (
                          <Link key={subItem.href} href={subItem.href}>
                            <Button
                              variant="ghost"
                              size="sm"
                              className={cn(
                                "w-full justify-start gap-2 h-8 px-2 hover:bg-sidebar-accent",
                                isSubActive &&
                                  "bg-sidebar-accent text-sidebar-primary",
                              )}
                            >
                              <subItem.icon className="w-4 h-4 shrink-0 text-muted-foreground" />
                              <span className="truncate text-sm">
                                {subItem.label}
                              </span>
                            </Button>
                          </Link>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            )}

            {/* Collapsed Library button */}
            {isCollapsed && showConnectedState && (
              <Link href="/library">
                <Button
                  variant="ghost"
                  className={cn(
                    "w-full justify-center h-10 px-0",
                    "hover:bg-sidebar-accent",
                    pathname.startsWith("/library") &&
                      "bg-sidebar-accent text-sidebar-primary font-semibold",
                  )}
                >
                  <Library
                    className={cn(
                      "w-5 h-5 shrink-0",
                      pathname.startsWith("/library") && "text-sidebar-primary",
                    )}
                  />
                </Button>
              </Link>
            )}

            {/* Liked Songs */}
            <Link href="/favorites">
              <Button
                variant="ghost"
                className={cn(
                  "w-full justify-start gap-4 h-10 px-3 overflow-hidden",
                  "hover:bg-sidebar-accent",
                  pathname.startsWith("/favorites") &&
                    "bg-sidebar-accent text-sidebar-primary",
                  isCollapsed && "justify-center px-0",
                )}
                disabled={hydrated && !isConnected}
              >
                <Heart
                  className={cn(
                    "w-5 h-5 shrink-0",
                    pathname.startsWith("/favorites") && "text-sidebar-primary",
                  )}
                />
                {!isCollapsed && (
                  <span className="truncate whitespace-nowrap">Favorites</span>
                )}
              </Button>
            </Link>

            {/* Recently Played */}
            <Link href="/history">
              <Button
                variant="ghost"
                className={cn(
                  "w-full justify-start gap-4 h-10 px-3 overflow-hidden",
                  "hover:bg-sidebar-accent",
                  pathname.startsWith("/history") &&
                    "bg-sidebar-accent text-sidebar-primary",
                  isCollapsed && "justify-center px-0",
                )}
                disabled={hydrated && !isConnected}
              >
                <History
                  className={cn(
                    "w-5 h-5 shrink-0",
                    pathname.startsWith("/history") && "text-sidebar-primary",
                  )}
                />
                {!isCollapsed && (
                  <span className="truncate whitespace-nowrap">
                    Recently Played
                  </span>
                )}
              </Button>
            </Link>

            {/* Playlists Section - Expandable */}
            {!isCollapsed && showConnectedState && (
              <>
                {hydrated && isConnected ? (
                  <Collapsible
                    open={playlistsExpanded}
                    onOpenChange={setPlaylistsExpanded}
                  >
                    <div className="relative">
                      <Link href="/playlists" className="block">
                        <Button
                          variant="ghost"
                          className={cn(
                            "w-full justify-start gap-4 h-10 px-3 pr-10 overflow-hidden",
                            "hover:bg-sidebar-accent",
                            pathname === "/playlists" &&
                              "bg-sidebar-accent text-sidebar-primary",
                          )}
                        >
                          <ListMusic
                            className={cn(
                              "w-5 h-5 shrink-0",
                              pathname === "/playlists" &&
                                "text-sidebar-primary",
                            )}
                          />
                          <span className="truncate whitespace-nowrap flex-1 text-left">
                            Playlists
                          </span>
                        </Button>
                      </Link>
                      <CollapsibleTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8",
                            "hover:bg-sidebar-accent/80",
                          )}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ChevronDown
                            className={cn(
                              "w-4 h-4 shrink-0 transition-transform duration-200",
                              playlistsExpanded && "rotate-180",
                            )}
                          />
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                    <CollapsibleContent>
                      <div className="pl-4 mt-1 space-y-0.5">
                        {playlistsLoading ? (
                          <PlaylistSkeletons />
                        ) : playlistTree ? (
                          <Suspense fallback={<PlaylistSkeletons />}>
                            <PlaylistFolderTreeWithSearchParams
                              folder={playlistTree}
                              pathname={pathname}
                              expandedFolders={expandedFolders}
                              toggleFolder={toggleFolder}
                              depth={0}
                              itemHeight={itemHeight}
                              iconContainerSize={iconContainerSize}
                              iconSize={iconSize}
                              coverSize={coverSize}
                              onPlayPlaylist={handlePlayPlaylist}
                              onPlaySmartPlaylist={handlePlaySmartPlaylist}
                            />
                          </Suspense>
                        ) : null}
                        {/* Smart Playlists - integrated with regular playlists */}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                ) : (
                  /* During SSR, show expanded Playlists with skeletons (default state) */
                  <>
                    <Link href="/playlists">
                      <Button
                        variant="ghost"
                        className={cn(
                          "w-full justify-start gap-4 h-10 px-3 overflow-hidden",
                          "hover:bg-sidebar-accent",
                          pathname === "/playlists" &&
                            "bg-sidebar-accent text-sidebar-primary",
                        )}
                      >
                        <ListMusic
                          className={cn(
                            "w-5 h-5 shrink-0",
                            pathname === "/playlists" && "text-sidebar-primary",
                          )}
                        />
                        <span className="truncate whitespace-nowrap">
                          Playlists
                        </span>
                      </Button>
                    </Link>
                    <div className="pl-4 mt-1 space-y-0.5">
                      <PlaylistSkeletons />
                    </div>
                  </>
                )}
              </>
            )}

            {/* Collapsed playlists button */}
            {isCollapsed && showConnectedState && (
              <Link href="/playlists">
                <Button
                  variant="ghost"
                  className={cn(
                    "w-full justify-center h-10 px-0",
                    "hover:bg-sidebar-accent",
                    pathname.startsWith("/playlists") &&
                      "bg-sidebar-accent text-sidebar-primary",
                  )}
                >
                  <ListMusic
                    className={cn(
                      "w-5 h-5 shrink-0",
                      pathname.startsWith("/playlists") &&
                        "text-sidebar-primary",
                    )}
                  />
                </Button>
              </Link>
            )}

            {hydrated && !isConnected && !isCollapsed && (
              <div className="px-3 py-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Connect to a server to see your library
                </p>
                <Link href="/login">
                  <Button variant="outline" size="sm" className="mt-2">
                    Connect
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Bottom Section */}
      <div className="p-2 space-y-1 border-t border-sidebar-border shrink-0">
        {/* User switcher / Profile */}
        <UserSwitcher
          isCollapsed={isCollapsed}
          isActive={pathname.startsWith("/profile")}
        />

        {/* Import link */}
        <Link href="/import">
          <Button
            variant="ghost"
            className={cn(
              "w-full justify-start gap-4 h-10 px-3 hover:bg-sidebar-accent overflow-hidden",
              pathname.startsWith("/import") &&
                "bg-sidebar-accent text-sidebar-primary font-semibold",
              isCollapsed && "justify-center px-0",
            )}
          >
            <Import
              className={cn(
                "w-5 h-5 shrink-0",
                pathname.startsWith("/import") && "text-sidebar-primary",
              )}
            />
            {!isCollapsed && (
              <span className="truncate whitespace-nowrap">Manage</span>
            )}
          </Button>
        </Link>

        <Link href="/settings">
          <Button
            variant="ghost"
            className={cn(
              "w-full justify-start gap-4 h-10 px-3 hover:bg-sidebar-accent overflow-hidden",
              pathname.startsWith("/settings") &&
                "bg-sidebar-accent text-sidebar-primary font-semibold",
              isCollapsed && "justify-center px-0",
            )}
          >
            <Settings
              className={cn(
                "w-5 h-5 shrink-0",
                pathname.startsWith("/settings") && "text-sidebar-primary",
              )}
            />
            {!isCollapsed && (
              <span className="truncate whitespace-nowrap">Settings</span>
            )}
          </Button>
        </Link>

        {/* Collapse Toggle */}
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-start gap-4 h-10 px-3 hover:bg-sidebar-accent overflow-hidden",
            isCollapsed && "justify-center px-0",
          )}
          onClick={() => hydrated && setCollapsed(!collapsed)}
        >
          {isCollapsed ? (
            <ChevronRight className="w-5 h-5 shrink-0" />
          ) : (
            <>
              <ChevronLeft className="w-5 h-5 shrink-0" />
              <span className="truncate whitespace-nowrap">Collapse</span>
            </>
          )}
        </Button>
      </div>
    </AsideComponent>
  );
}

// Skeleton for playlist items in sidebar with varied widths to simulate realistic names
const SKELETON_WIDTHS = ["w-3/4", "w-1/2", "w-2/3", "w-4/5", "w-5/6"] as const;

function PlaylistSkeletonItem({ index = 0 }: { index?: number }) {
  // Use deterministic width based on index to avoid hydration issues
  const widthClass = SKELETON_WIDTHS[index % SKELETON_WIDTHS.length];

  return (
    <div className="flex items-center gap-2 h-8 px-2">
      <Skeleton className="w-4 h-4 rounded shrink-0" />
      <Skeleton className={cn("h-3 rounded", widthClass)} />
    </div>
  );
}

// Helper component to render multiple playlist skeletons
function PlaylistSkeletons() {
  return (
    <>
      <PlaylistSkeletonItem index={0} />
      <PlaylistSkeletonItem index={1} />
      <PlaylistSkeletonItem index={2} />
    </>
  );
}

// Recursive component to render playlist folder tree
interface PlaylistFolderTreeProps {
  folder: PlaylistFolder;
  pathname: string;
  searchParams: URLSearchParams;
  expandedFolders: string[];
  toggleFolder: (path: string) => void;
  depth: number;
  itemHeight: string;
  iconContainerSize: string;
  iconSize: string;
  coverSize: string;
  onPlayPlaylist: (playlist: Playlist) => void;
  onPlaySmartPlaylist: (id: string, name: string) => void;
}

function PlaylistFolderTree({
  folder,
  pathname,
  searchParams,
  expandedFolders,
  toggleFolder,
  depth,
  itemHeight,
  iconContainerSize,
  iconSize,
  coverSize,
  onPlayPlaylist,
  onPlaySmartPlaylist,
}: PlaylistFolderTreeProps) {
  return (
    <>
      {/* Subfolders */}
      {folder.subfolders.map((subfolder) => {
        const isExpanded = expandedFolders.includes(subfolder.path);
        const isFolderActive =
          pathname === "/playlists" &&
          searchParams.get("folder") === subfolder.path;

        // Get cover art URL for folder (uses pf- prefix)
        const folderCoverArtUrl =
          subfolder.id && subfolder.hasCoverArt
            ? getClient()?.getCoverArtUrl(`pf-${subfolder.id}`, "small")
            : undefined;

        return (
          <Collapsible
            key={subfolder.path}
            open={isExpanded}
            onOpenChange={() => toggleFolder(subfolder.path)}
          >
            <div className="relative flex items-center">
              <Link
                href={`/playlists?folder=${encodeURIComponent(subfolder.path)}`}
                className="flex-1 min-w-0"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "w-full justify-start gap-2 px-2 pr-8 hover:bg-sidebar-accent",
                    itemHeight,
                    isFolderActive && "bg-sidebar-accent text-sidebar-primary",
                  )}
                  style={{ paddingLeft: `${depth * 12 + 8}px` }}
                >
                  {/* Always show folder icon */}
                  <div
                    className={cn(
                      iconContainerSize,
                      "shrink-0 flex items-center justify-center",
                    )}
                  >
                    {isExpanded ? (
                      <FolderOpen
                        className={cn(iconSize, "text-muted-foreground")}
                      />
                    ) : (
                      <Folder
                        className={cn(iconSize, "text-muted-foreground")}
                      />
                    )}
                  </div>
                  {/* Show cover art to the right of folder icon if available */}
                  {folderCoverArtUrl && (
                    <CoverImage
                      src={folderCoverArtUrl}
                      alt={subfolder.name}
                      type="folder"
                      size="sm"
                      colorSeed={subfolder.path}
                      className={cn(coverSize, "rounded-[3px]")}
                    />
                  )}
                  <span className="truncate text-sm">{subfolder.name}</span>
                </Button>
              </Link>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "absolute right-0 w-8 hover:bg-sidebar-accent/80",
                    itemHeight,
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  <ChevronDown
                    className={cn(
                      "w-3 h-3 shrink-0 transition-transform duration-200",
                      isExpanded && "rotate-180",
                    )}
                  />
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent>
              <PlaylistFolderTree
                folder={subfolder}
                pathname={pathname}
                searchParams={searchParams}
                expandedFolders={expandedFolders}
                toggleFolder={toggleFolder}
                depth={depth + 1}
                itemHeight={itemHeight}
                iconContainerSize={iconContainerSize}
                iconSize={iconSize}
                coverSize={coverSize}
                onPlayPlaylist={onPlayPlaylist}
                onPlaySmartPlaylist={onPlaySmartPlaylist}
              />
            </CollapsibleContent>
          </Collapsible>
        );
      })}

      {/* Playlists in this folder (regular and smart combined) */}
      {[
        ...folder.playlists.map((p) => ({
          type: "regular" as const,
          id: p.id,
          name: getPlaylistDisplayName(p),
          data: p,
        })),
        ...folder.smartPlaylists.map((sp) => ({
          type: "smart" as const,
          id: sp.id,
          name: parsePlaylistPath(sp.name).displayName || sp.name,
          data: sp,
        })),
      ]
        .sort((a, b) =>
          a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
        )
        .map((item) => {
          if (item.type === "regular") {
            const playlist = item.data as Playlist;
            const isActive =
              pathname === `/playlists/details` &&
              searchParams.get("id") === playlist.id;

            // Get cover art URL for playlist (uses playlist ID for tiled cover)
            const artId = playlist.coverArt || playlist.id;
            const coverArtUrl = getClient()?.getCoverArtUrl(artId, "small");

            return (
              <PlaylistContextMenu
                key={playlist.id}
                playlist={playlist}
                currentFolderId={folder.id ?? null}
              >
                <div
                  className={cn(
                    "group/item flex items-center gap-2 px-2 rounded-sm hover:bg-sidebar-accent transition-colors",
                    itemHeight,
                    isActive && "bg-sidebar-accent text-sidebar-primary",
                  )}
                  style={{ paddingLeft: `${depth * 12 + 8}px` }}
                >
                  {/* Playlist icon */}
                  <div
                    className={cn(
                      iconContainerSize,
                      "shrink-0 flex items-center justify-center",
                    )}
                  >
                    <ListMusic
                      className={cn(iconSize, "text-muted-foreground")}
                    />
                  </div>
                  {/* Playable cover art */}
                  <button
                    type="button"
                    className="relative shrink-0 group/cover"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onPlayPlaylist(playlist);
                    }}
                  >
                    <CoverImage
                      src={coverArtUrl}
                      alt={item.name}
                      type="playlist"
                      size="sm"
                      colorSeed={playlist.id}
                      className={cn(coverSize, "rounded-[3px]")}
                    />
                    {/* Play overlay on hover */}
                    <div
                      className={cn(
                        "absolute inset-0 flex items-center justify-center",
                        "bg-black/60 opacity-0 group-hover/cover:opacity-100 transition-opacity rounded-[3px]",
                      )}
                    >
                      <Play className="w-3 h-3 text-white fill-white" />
                    </div>
                  </button>
                  {/* Playlist name links to details */}
                  <Link
                    href={`/playlists/details?id=${playlist.id}`}
                    className="flex-1 min-w-0"
                  >
                    <span className="truncate text-sm block hover:underline">
                      {item.name}
                    </span>
                  </Link>
                </div>
              </PlaylistContextMenu>
            );
          } else {
            // Smart Playlist
            const sp = item.data as { id: string; name: string };
            const isActive =
              pathname === "/playlists/smart" &&
              searchParams.get("id") === sp.id;

            // Get cover art URL for smart playlist (uses sp- prefix)
            const coverArtUrl = getClient()?.getCoverArtUrl(
              `sp-${sp.id}`,
              "small",
            );

            const smartPlaylist = item.data as SmartPlaylist;

            return (
              <SmartPlaylistContextMenu
                key={sp.id}
                smartPlaylist={smartPlaylist}
              >
                <div
                  className={cn(
                    "group/item flex items-center gap-2 px-2 rounded-sm hover:bg-sidebar-accent transition-colors",
                    itemHeight,
                    isActive && "bg-sidebar-accent text-sidebar-primary",
                  )}
                  style={{ paddingLeft: `${depth * 12 + 8}px` }}
                >
                  {/* Sparkle icon to indicate smart playlist */}
                  <div
                    className={cn(
                      iconContainerSize,
                      "shrink-0 flex items-center justify-center",
                    )}
                  >
                    <Sparkles
                      className={cn(iconSize, "text-muted-foreground")}
                    />
                  </div>
                  {/* Playable cover art */}
                  <button
                    type="button"
                    className="relative shrink-0 group/cover"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onPlaySmartPlaylist(sp.id, item.name);
                    }}
                  >
                    <CoverImage
                      src={coverArtUrl}
                      alt={item.name}
                      type="smartPlaylist"
                      size="sm"
                      colorSeed={`smart-${sp.id}`}
                      className={cn(coverSize, "rounded-[3px]")}
                    />
                    {/* Play overlay on hover */}
                    <div
                      className={cn(
                        "absolute inset-0 flex items-center justify-center",
                        "bg-black/60 opacity-0 group-hover/cover:opacity-100 transition-opacity rounded-[3px]",
                      )}
                    >
                      <Play className="w-3 h-3 text-white fill-white" />
                    </div>
                  </button>
                  {/* Playlist name links to details */}
                  <Link
                    href={`/playlists/smart?id=${sp.id}`}
                    className="flex-1 min-w-0"
                  >
                    <span className="truncate text-sm block hover:underline">
                      {item.name}
                    </span>
                  </Link>
                </div>
              </SmartPlaylistContextMenu>
            );
          }
        })}
    </>
  );
}

// Wrapper component that uses useSearchParams - isolated in its own Suspense boundary
// This prevents the entire Sidebar from suspending during SSR
interface PlaylistFolderTreeWithSearchParamsProps {
  folder: PlaylistFolder;
  pathname: string;
  expandedFolders: string[];
  toggleFolder: (path: string) => void;
  depth: number;
  itemHeight: string;
  iconContainerSize: string;
  iconSize: string;
  coverSize: string;
  onPlayPlaylist: (playlist: Playlist) => void;
  onPlaySmartPlaylist: (id: string, name: string) => void;
}

function PlaylistFolderTreeWithSearchParams({
  folder,
  pathname,
  expandedFolders,
  toggleFolder,
  depth,
  itemHeight,
  iconContainerSize,
  iconSize,
  coverSize,
  onPlayPlaylist,
  onPlaySmartPlaylist,
}: PlaylistFolderTreeWithSearchParamsProps) {
  const searchParams = useSearchParams();

  return (
    <PlaylistFolderTree
      folder={folder}
      pathname={pathname}
      searchParams={searchParams}
      expandedFolders={expandedFolders}
      toggleFolder={toggleFolder}
      depth={depth}
      itemHeight={itemHeight}
      iconContainerSize={iconContainerSize}
      iconSize={iconSize}
      coverSize={coverSize}
      onPlayPlaylist={onPlayPlaylist}
      onPlaySmartPlaylist={onPlaySmartPlaylist}
    />
  );
}

// Smart playlists list component with search params
