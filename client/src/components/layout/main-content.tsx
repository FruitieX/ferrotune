"use client";

import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { queuePanelOpenAtom, sidebarCollapsedAtom, sidebarWidthAtom } from "@/lib/store/ui";
import { useHydrated } from "@/lib/hooks/use-hydrated";

const QUEUE_SIDEBAR_WIDTH = 360;
const COLLAPSED_SIDEBAR_WIDTH = 72;

interface MainContentProps {
  children: React.ReactNode;
}

/**
 * Main content wrapper that handles responsive margins
 * based on sidebar and queue panel states.
 * 
 * CSS variables are initialized by a blocking script in the document head
 * to prevent layout flash. This component updates them when state changes.
 */
export function MainContent({ children }: MainContentProps) {
  const hydrated = useHydrated();
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom);
  const sidebarWidth = useAtomValue(sidebarWidthAtom);
  const queueOpen = useAtomValue(queuePanelOpenAtom);

  // Update CSS variables when state changes (after hydration)
  useEffect(() => {
    if (!hydrated) return;
    
    // Set queue sidebar width
    const queueWidth = queueOpen ? QUEUE_SIDEBAR_WIDTH : 0;
    document.documentElement.style.setProperty('--queue-sidebar-width', `${queueWidth}px`);
    
    // Set left sidebar width
    const leftWidth = sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : sidebarWidth;
    document.documentElement.style.setProperty('--sidebar-width', `${leftWidth}px`);
  }, [hydrated, queueOpen, sidebarCollapsed, sidebarWidth]);

  // CSS variables are set by the init script in layout.tsx head
  // so we can use them directly in className without worrying about flash
  return (
    <main 
      id="main-scroll-container"
      className="flex-1 overflow-y-auto overflow-x-hidden transition-[margin] duration-200 lg:ml-[var(--sidebar-width)] xl:mr-[var(--queue-sidebar-width)]"
    >
      {children}
    </main>
  );
}
