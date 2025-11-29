"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, Library, ListMusic, User } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/search", icon: Search, label: "Search" },
  { href: "/library", icon: Library, label: "Library" },
  { href: "/library/playlists", icon: ListMusic, label: "Playlists" },
  { href: "/settings", icon: User, label: "Profile" },
];

export function MobileNav() {
  const pathname = usePathname();

  // Don't show on login page
  if (pathname === "/login") {
    return null;
  }

  return (
    <nav
      className={cn(
        "lg:hidden fixed bottom-0 left-0 right-0 z-50",
        "bg-background/95 backdrop-blur-lg border-t border-border",
        "pb-safe" // Safe area for iOS
      )}
    >
      <div className="flex items-center justify-around h-16">
        {navItems.map((item) => {
          const isActive = item.href === "/" 
            ? pathname === "/" 
            : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 w-full h-full",
                "text-muted-foreground transition-colors",
                isActive && "text-primary"
              )}
            >
              <item.icon className={cn("w-5 h-5", isActive && "text-primary")} />
              <span className="text-xs font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
