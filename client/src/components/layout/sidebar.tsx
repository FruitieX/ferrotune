"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { useAtom, useAtomValue } from "jotai";
import {
  Home,
  Search,
  Library,
  ListMusic,
  Heart,
  Plus,
  ChevronLeft,
  ChevronRight,
  Settings,
  Music2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  sidebarCollapsedAtom,
  sidebarWidthAtom,
} from "@/lib/store/ui";
import { isConnectedAtom } from "@/lib/store/auth";

const navItems = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/search", icon: Search, label: "Search" },
  { href: "/library", icon: Library, label: "Library" },
];

const libraryItems = [
  { href: "/favorites", icon: Heart, label: "Liked Songs" },
  { href: "/playlists", icon: ListMusic, label: "Playlists" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom);
  const sidebarWidth = useAtomValue(sidebarWidthAtom);
  const isConnected = useAtomValue(isConnectedAtom);

  // Don't show sidebar on login page
  if (pathname === "/login") {
    return null;
  }

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 72 : sidebarWidth }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className={cn(
        "hidden lg:flex flex-col h-full bg-sidebar border-r border-sidebar-border",
        "fixed left-0 top-0 bottom-[88px] z-40"
      )}
    >
      {/* Logo */}
      <div className="flex items-center h-16 px-4 gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary">
          <Music2 className="w-6 h-6 text-primary-foreground" />
        </div>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="font-bold text-xl text-foreground"
          >
            Ferrotune
          </motion.span>
        )}
      </div>

      {/* Main Navigation */}
      <nav className="px-2 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = item.href === "/" 
            ? pathname === "/" 
            : pathname.startsWith(item.href);
          
          return (
            <Link key={item.href} href={item.href}>
              <Button
                variant="ghost"
                className={cn(
                  "w-full justify-start gap-4 h-11 px-3",
                  "hover:bg-sidebar-accent",
                  isActive && "bg-sidebar-accent text-sidebar-primary font-semibold",
                  collapsed && "justify-center px-0"
                )}
              >
                <item.icon className={cn("w-5 h-5 shrink-0", isActive && "text-sidebar-primary")} />
                {!collapsed && (
                  <span className="truncate">{item.label}</span>
                )}
              </Button>
            </Link>
          );
        })}
      </nav>

      <Separator className="mx-4 bg-sidebar-border" />

      {/* Library Section */}
      <div className="flex-1 flex flex-col min-h-0 py-4">
        {!collapsed && (
          <div className="px-4 mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Your Library
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 hover:bg-sidebar-accent"
              disabled={!isConnected}
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        )}

        <ScrollArea className="flex-1 px-2">
          <div className="space-y-1">
            {libraryItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              
              return (
                <Link key={item.href} href={item.href}>
                  <Button
                    variant="ghost"
                    className={cn(
                      "w-full justify-start gap-4 h-10 px-3",
                      "hover:bg-sidebar-accent",
                      isActive && "bg-sidebar-accent text-sidebar-primary",
                      collapsed && "justify-center px-0"
                    )}
                    disabled={!isConnected}
                  >
                    <item.icon className={cn("w-5 h-5 shrink-0", isActive && "text-sidebar-primary")} />
                    {!collapsed && (
                      <span className="truncate">{item.label}</span>
                    )}
                  </Button>
                </Link>
              );
            })}

            {/* Playlist placeholders */}
            {!collapsed && isConnected && (
              <div className="pt-2 space-y-1">
                {/* Playlists will be loaded here */}
              </div>
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
              "w-full justify-start gap-4 h-10 px-3 hover:bg-sidebar-accent",
              collapsed && "justify-center px-0"
            )}
          >
            <Settings className="w-5 h-5" />
            {!collapsed && <span>Settings</span>}
          </Button>
        </Link>

        {/* Collapse Toggle */}
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-start gap-4 h-10 px-3 hover:bg-sidebar-accent",
            collapsed && "justify-center px-0"
          )}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <ChevronRight className="w-5 h-5" />
          ) : (
            <>
              <ChevronLeft className="w-5 h-5" />
              <span>Collapse</span>
            </>
          )}
        </Button>
      </div>
    </motion.aside>
  );
}

// Loading skeleton for sidebar
export function SidebarSkeleton() {
  return (
    <aside className="hidden lg:flex flex-col w-[280px] h-full bg-sidebar border-r border-sidebar-border">
      <div className="flex items-center h-16 px-4 gap-3">
        <Skeleton className="w-10 h-10 rounded-lg" />
        <Skeleton className="w-24 h-6" />
      </div>
      <div className="px-2 py-4 space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-11 rounded-md" />
        ))}
      </div>
    </aside>
  );
}
