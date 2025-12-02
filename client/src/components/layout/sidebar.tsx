"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useAtom, useAtomValue } from "jotai";
import { useQuery } from "@tanstack/react-query";
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
  Music2,
  Folder,
  FolderOpen,
  Disc,
  Users,
  Music,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "@/lib/store/ui";
import { isConnectedAtom } from "@/lib/store/auth";
import { getClient } from "@/lib/api/client";
import {
  organizePlaylistsIntoFolders,
  getPlaylistDisplayName,
  type PlaylistFolder,
} from "@/lib/utils/playlist-folders";
import type { Playlist } from "@/lib/api/types";

const navItems = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/search", icon: Search, label: "Search" },
];

const librarySubItems = [
  { href: "/library/albums", icon: Disc, label: "Albums" },
  { href: "/library/artists", icon: Users, label: "Artists" },
  { href: "/library/songs", icon: Music, label: "Songs" },
  { href: "/library/genres", icon: Tag, label: "Genres" },
];

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hydrated = useHydrated();
  const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom);
  const sidebarWidth = useAtomValue(sidebarWidthAtom);
  const isConnected = useAtomValue(isConnectedAtom);
  const [playlistsExpanded, setPlaylistsExpanded] = useAtom(playlistsSidebarExpandedAtom);
  const [libraryExpanded, setLibraryExpanded] = useAtom(librarySidebarExpandedAtom);
  const [expandedFolders, setExpandedFolders] = useAtom(expandedPlaylistFoldersAtom);

  // Fetch playlists
  const { data: playlists, isLoading: playlistsLoading } = useQuery({
    queryKey: ["playlists"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getPlaylists();
      return response.playlists.playlist ?? [];
    },
    enabled: isConnected,
  });

  // Organize playlists into folder structure
  const playlistTree = playlists ? organizePlaylistsIntoFolders(playlists) : null;

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );
  };

  // Update CSS variable when collapsed state changes (after hydration)
  useEffect(() => {
    if (!hydrated) return;
    const width = collapsed ? 72 : sidebarWidth;
    document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
  }, [hydrated, collapsed, sidebarWidth]);

  // Don't show sidebar on login page
  if (pathname === "/login") {
    return null;
  }

  // Before hydration, render with CSS variable width to match the init script
  // This prevents the sidebar from flashing between states
  if (!hydrated) {
    return (
      <aside
        style={{ width: 'var(--sidebar-width)' }}
        className={cn(
          "hidden lg:flex flex-col bg-sidebar border-r border-sidebar-border overflow-hidden",
          "fixed left-0 top-0 bottom-[88px] z-40"
        )}
      >
        {/* Minimal skeleton content */}
        <div className="flex items-center h-16 px-4 gap-3 overflow-hidden">
          <div className="flex items-center justify-center w-10 h-10 shrink-0 rounded-lg bg-primary">
            <Music2 className="w-6 h-6 text-primary-foreground" />
          </div>
        </div>
      </aside>
    );
  }

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 72 : sidebarWidth }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className={cn(
        "hidden lg:flex flex-col bg-sidebar border-r border-sidebar-border overflow-hidden",
        "fixed left-0 top-0 bottom-[88px] z-40"
      )}
    >
      {/* Logo */}
      <div className="flex items-center h-16 px-4 gap-3 overflow-hidden">
        <div className="flex items-center justify-center w-10 h-10 shrink-0 rounded-lg bg-primary">
          <Music2 className="w-6 h-6 text-primary-foreground" />
        </div>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="font-bold text-xl text-foreground whitespace-nowrap"
          >
            Ferrotune
          </motion.span>
        )}
      </div>

      {/* Main Navigation */}
      <nav className="px-2 py-4">
        <div className="space-y-1.5">
          {navItems.map((item) => {
            const isActive = item.href === "/" 
              ? pathname === "/" 
              : pathname.startsWith(item.href);
            
            return (
              <Link key={item.href} href={item.href}>
                <Button
                  variant="ghost"
                  className={cn(
                    "w-full justify-start gap-4 h-11 px-3 overflow-hidden",
                    "hover:bg-sidebar-accent",
                    isActive && "bg-sidebar-accent text-sidebar-primary font-semibold",
                    collapsed && "justify-center px-0"
                  )}
                >
                  <item.icon className={cn("w-5 h-5 shrink-0", isActive && "text-sidebar-primary")} />
                  {!collapsed && (
                    <span className="truncate whitespace-nowrap">{item.label}</span>
                  )}
                </Button>
              </Link>
            );
          })}
          
          {/* Library Section - Expandable */}
          {!collapsed && isConnected && (
            <Collapsible open={libraryExpanded} onOpenChange={setLibraryExpanded}>
              <div className="relative">
                <Link href="/library" className="block">
                  <Button
                    variant="ghost"
                    className={cn(
                      "w-full justify-start gap-4 h-11 px-3 pr-10 overflow-hidden",
                      "hover:bg-sidebar-accent",
                      pathname.startsWith("/library") && "bg-sidebar-accent text-sidebar-primary font-semibold"
                    )}
                  >
                    <Library className={cn("w-5 h-5 shrink-0", pathname.startsWith("/library") && "text-sidebar-primary")} />
                    <span className="truncate whitespace-nowrap flex-1 text-left">Library</span>
                  </Button>
                </Link>
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8",
                      "hover:bg-sidebar-accent/80"
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ChevronDown className={cn(
                      "w-4 h-4 shrink-0 transition-transform duration-200",
                      libraryExpanded && "rotate-180"
                    )} />
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
                            isSubActive && "bg-sidebar-accent text-sidebar-primary"
                          )}
                        >
                          <subItem.icon className="w-4 h-4 shrink-0 text-muted-foreground" />
                          <span className="truncate text-sm">{subItem.label}</span>
                        </Button>
                      </Link>
                    );
                  })}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Collapsed Library button */}
          {collapsed && isConnected && (
            <Link href="/library">
              <Button
                variant="ghost"
                className={cn(
                  "w-full justify-center h-11 px-0",
                  "hover:bg-sidebar-accent",
                  pathname.startsWith("/library") && "bg-sidebar-accent text-sidebar-primary font-semibold"
                )}
              >
                <Library className={cn("w-5 h-5 shrink-0", pathname.startsWith("/library") && "text-sidebar-primary")} />
              </Button>
            </Link>
          )}
        </div>
      </nav>

      <Separator className="mx-2 bg-sidebar-border" />

      {/* Library Section */}
      <div className="flex-1 flex flex-col min-h-0 py-4 overflow-hidden">
        {!collapsed && (
          <div className="px-4 mb-2 overflow-hidden">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
              Your Library
            </span>
          </div>
        )}

        <ScrollArea className="flex-1 px-2">
          <div className="space-y-1.5">
            {/* Liked Songs */}
            <Link href="/favorites">
              <Button
                variant="ghost"
                className={cn(
                  "w-full justify-start gap-4 h-10 px-3 overflow-hidden",
                  "hover:bg-sidebar-accent",
                  pathname.startsWith("/favorites") && "bg-sidebar-accent text-sidebar-primary",
                  collapsed && "justify-center px-0"
                )}
                disabled={!isConnected}
              >
                <Heart className={cn("w-5 h-5 shrink-0", pathname.startsWith("/favorites") && "text-sidebar-primary")} />
                {!collapsed && <span className="truncate whitespace-nowrap">Liked Songs</span>}
              </Button>
            </Link>

            {/* Recently Played */}
            <Link href="/history">
              <Button
                variant="ghost"
                className={cn(
                  "w-full justify-start gap-4 h-10 px-3 overflow-hidden",
                  "hover:bg-sidebar-accent",
                  pathname.startsWith("/history") && "bg-sidebar-accent text-sidebar-primary",
                  collapsed && "justify-center px-0"
                )}
                disabled={!isConnected}
              >
                <History className={cn("w-5 h-5 shrink-0", pathname.startsWith("/history") && "text-sidebar-primary")} />
                {!collapsed && <span className="truncate whitespace-nowrap">Recently Played</span>}
              </Button>
            </Link>

            {/* Playlists Section */}
            {!collapsed && isConnected && (
              <Collapsible open={playlistsExpanded} onOpenChange={setPlaylistsExpanded}>
                <div className="relative">
                  <Link href="/playlists" className="block">
                    <Button
                      variant="ghost"
                      className={cn(
                        "w-full justify-start gap-4 h-10 px-3 pr-10 overflow-hidden",
                        "hover:bg-sidebar-accent",
                        pathname.startsWith("/playlists") && "bg-sidebar-accent text-sidebar-primary"
                      )}
                    >
                      <ListMusic className={cn("w-5 h-5 shrink-0", pathname.startsWith("/playlists") && "text-sidebar-primary")} />
                      <span className="truncate whitespace-nowrap flex-1 text-left">Playlists</span>
                    </Button>
                  </Link>
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8",
                        "hover:bg-sidebar-accent/80"
                      )}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ChevronDown className={cn(
                        "w-4 h-4 shrink-0 transition-transform duration-200",
                        playlistsExpanded && "rotate-180"
                      )} />
                    </Button>
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent>
                  <div className="pl-4 mt-1 space-y-0.5">
                    {playlistsLoading ? (
                      <>
                        <Skeleton className="h-8 w-full rounded" />
                        <Skeleton className="h-8 w-full rounded" />
                        <Skeleton className="h-8 w-full rounded" />
                      </>
                    ) : playlistTree ? (
                      <PlaylistFolderTree
                        folder={playlistTree}
                        pathname={pathname}
                        searchParams={searchParams}
                        expandedFolders={expandedFolders}
                        toggleFolder={toggleFolder}
                        depth={0}
                      />
                    ) : null}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Collapsed playlists button */}
            {collapsed && isConnected && (
              <Link href="/playlists">
                <Button
                  variant="ghost"
                  className={cn(
                    "w-full justify-center h-10 px-0",
                    "hover:bg-sidebar-accent",
                    pathname.startsWith("/playlists") && "bg-sidebar-accent text-sidebar-primary"
                  )}
                >
                  <ListMusic className={cn("w-5 h-5 shrink-0", pathname.startsWith("/playlists") && "text-sidebar-primary")} />
                </Button>
              </Link>
            )}

            {!isConnected && !collapsed && (
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
        </ScrollArea>
      </div>

      {/* Bottom Section */}
      <div className="p-2 space-y-1 border-t border-sidebar-border">
        <Link href="/settings">
          <Button
            variant="ghost"
            className={cn(
              "w-full justify-start gap-4 h-10 px-3 hover:bg-sidebar-accent overflow-hidden",
              collapsed && "justify-center px-0"
            )}
          >
            <Settings className="w-5 h-5 shrink-0" />
            {!collapsed && <span className="truncate whitespace-nowrap">Settings</span>}
          </Button>
        </Link>

        {/* Collapse Toggle */}
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-start gap-4 h-10 px-3 hover:bg-sidebar-accent overflow-hidden",
            collapsed && "justify-center px-0"
          )}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <ChevronRight className="w-5 h-5 shrink-0" />
          ) : (
            <>
              <ChevronLeft className="w-5 h-5 shrink-0" />
              <span className="truncate whitespace-nowrap">Collapse</span>
            </>
          )}
        </Button>
      </div>
    </motion.aside>
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
}

function PlaylistFolderTree({
  folder,
  pathname,
  searchParams,
  expandedFolders,
  toggleFolder,
  depth,
}: PlaylistFolderTreeProps) {
  return (
    <>
      {/* Subfolders */}
      {folder.subfolders.map((subfolder) => {
        const isExpanded = expandedFolders.includes(subfolder.path);
        
        return (
          <Collapsible key={subfolder.path} open={isExpanded} onOpenChange={() => toggleFolder(subfolder.path)}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 h-8 px-2 hover:bg-sidebar-accent"
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
              >
                {isExpanded ? (
                  <FolderOpen className="w-4 h-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Folder className="w-4 h-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate text-sm">{subfolder.name}</span>
                <ChevronDown className={cn(
                  "w-3 h-3 shrink-0 ml-auto transition-transform duration-200",
                  isExpanded && "rotate-180"
                )} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <PlaylistFolderTree
                folder={subfolder}
                pathname={pathname}
                searchParams={searchParams}
                expandedFolders={expandedFolders}
                toggleFolder={toggleFolder}
                depth={depth + 1}
              />
            </CollapsibleContent>
          </Collapsible>
        );
      })}

      {/* Playlists in this folder */}
      {folder.playlists.map((playlist) => {
        const isActive = pathname === `/playlists/details` && searchParams.get('id') === playlist.id;
        const displayName = getPlaylistDisplayName(playlist);
        
        return (
          <Link key={playlist.id} href={`/playlists/details?id=${playlist.id}`}>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "w-full justify-start gap-2 h-8 px-2 hover:bg-sidebar-accent",
                isActive && "bg-sidebar-accent text-sidebar-primary"
              )}
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
            >
              <ListMusic className="w-4 h-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm">{displayName}</span>
            </Button>
          </Link>
        );
      })}
    </>
  );
}

// Loading skeleton for sidebar - renders nothing to prevent flash
// The main layout CSS handles the initial state
export function SidebarSkeleton() {
  return null;
}
