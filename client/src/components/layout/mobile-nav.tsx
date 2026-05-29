"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Home, Search, Library, ListMusic, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { hapticTap } from "@/lib/utils/haptic";

const navItems = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/search", icon: Search, label: "Search" },
  { href: "/library", icon: Library, label: "Library" },
  { href: "/playlists", icon: ListMusic, label: "Playlists" },
  { href: "/settings", icon: User, label: "Settings" },
];

export function MobileNav() {
  const pathname = usePathname();

  // Don't show on login page
  if (pathname === "/login") {
    return null;
  }

  return (
    <nav
      data-testid="mobile-nav"
      className={cn(
        "lg:hidden z-50",
        "bg-background/95 backdrop-blur-lg border-t border-border",
        "pb-safe", // Safe area for iOS
      )}
    >
      <div className="flex items-center justify-around h-16 px-1">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => hapticTap()}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 w-full h-full relative",
                "text-muted-foreground transition-colors touch-manipulation",
                // Pill-shaped active press indicator instead of square highlight
                "rounded-xl active:scale-95",
                isActive && "text-primary",
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="mobile-nav-indicator"
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-0.5 bg-primary rounded-full"
                  transition={{
                    type: "spring",
                    stiffness: 500,
                    damping: 35,
                  }}
                />
              )}
              <motion.div
                animate={isActive ? { scale: 1.1 } : { scale: 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              >
                <item.icon
                  className={cn(
                    "w-5 h-5 transition-colors",
                    isActive && "text-primary",
                  )}
                />
              </motion.div>
              <span
                className={cn(
                  "text-[10px] leading-tight transition-all",
                  isActive ? "font-semibold" : "font-medium",
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
