"use client";

import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { queuePanelOpenAtom, sidebarCollapsedAtom, sidebarWidthAtom } from "@/lib/store/ui";

const QUEUE_SIDEBAR_WIDTH = 360;

interface MainContentProps {
  children: React.ReactNode;
}

/**
 * Main content wrapper that handles responsive margins
 * based on sidebar and queue panel states.
 */
export function MainContent({ children }: MainContentProps) {
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom);
  const sidebarWidth = useAtomValue(sidebarWidthAtom);
  const queueOpen = useAtomValue(queuePanelOpenAtom);

  // Update CSS variable for queue sidebar width
  useEffect(() => {
    const width = queueOpen ? QUEUE_SIDEBAR_WIDTH : 0;
    document.documentElement.style.setProperty('--queue-sidebar-width', `${width}px`);
  }, [queueOpen]);

  // Calculate left sidebar width
  const leftSidebarWidth = sidebarCollapsed ? 72 : sidebarWidth;

  return (
    <main 
      id="main-scroll-container"
      className="flex-1 overflow-y-auto overflow-x-hidden transition-[margin] duration-200"
      style={{
        marginLeft: `var(--sidebar-width, ${leftSidebarWidth}px)`,
        marginRight: `var(--queue-sidebar-width, 0px)`,
      }}
    >
      {children}
    </main>
  );
}
