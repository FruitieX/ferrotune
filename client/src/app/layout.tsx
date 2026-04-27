import { Suspense } from "react";
import { Providers } from "@/components/providers";
import { SetupGuard } from "@/components/setup-guard";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { PlayerBar } from "@/components/layout/player-bar";
import { SwipeableFooter } from "@/components/layout/swipeable-footer";
import { QueueSidebar } from "@/components/queue/queue";
import { MobileQueueSheet } from "@/components/queue/mobile-queue-sheet";
import { FullscreenPlayer } from "@/components/player/fullscreen-player";
import { MainContent } from "@/components/layout/main-content";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <Providers>
      <SetupGuard>
        <div className="h-dvh flex flex-col pt-safe">
          {/* Main container - takes up all space except footer */}
          <div className="flex flex-1 min-h-0">
            {/* Sidebar - hidden on mobile, spans full height of main container */}
            <Sidebar />

            {/* Main content area - uses MainContent wrapper for responsive margins */}
            <MainContent>
              <Suspense>{children}</Suspense>
            </MainContent>

            {/* Queue sidebar - desktop only, fixed right side, spans full height of main container */}
            <QueueSidebar />

            {/* Queue panel - mobile/tablet sheet that slides from right */}
            <MobileQueueSheet />
          </div>

          {/* Footer section - player bar and mobile nav */}
          {/* Wrapped in SwipeableFooter to enable swipe-up to fullscreen on mobile */}
          <SwipeableFooter>
            {/* Player bar */}
            <PlayerBar />

            {/* Mobile navigation - only on mobile */}
            <div className="lg:hidden">
              <MobileNav />
            </div>
          </SwipeableFooter>

          {/* Fullscreen player - modal overlay */}
          <FullscreenPlayer />
        </div>
      </SetupGuard>
    </Providers>
  );
}
