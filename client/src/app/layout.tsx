import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Sidebar, SidebarSkeleton } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { PlayerBar } from "@/components/layout/player-bar";
import { QueuePanel } from "@/components/queue/queue-panel";
import { QueueSidebar } from "@/components/queue/queue-sidebar";
import { FullscreenPlayer } from "@/components/player/fullscreen-player";
import { MainContent } from "@/components/layout/main-content";

// Script that runs before React hydration to set CSS variables based on localStorage
// This prevents layout flash by ensuring the correct sidebar widths are set immediately
const initSidebarScript = `
(function() {
  try {
    var collapsed = localStorage.getItem('ferrotune-sidebar-collapsed');
    var width = localStorage.getItem('ferrotune-sidebar-width');
    var sidebarWidth = collapsed === 'true' ? 72 : (parseInt(width) || 280);
    document.documentElement.style.setProperty('--sidebar-width', sidebarWidth + 'px');
    document.documentElement.style.setProperty('--queue-sidebar-width', '0px');
  } catch(e) {}
})();
`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ferrotune",
  description: "A modern music player for your personal library",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Ferrotune",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Inject script to set CSS variables before render to prevent layout flash */}
        <script dangerouslySetInnerHTML={{ __html: initSidebarScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased overflow-hidden`}
      >
        <Providers>
          <div className="h-screen flex flex-col">
            {/* Main content row */}
            <div className="flex flex-1 min-h-0">
              {/* Sidebar - hidden on mobile */}
              <Suspense fallback={<SidebarSkeleton />}>
                <Sidebar />
              </Suspense>
              
              {/* Main content area - uses MainContent wrapper for responsive margins */}
              <MainContent>
                {children}
              </MainContent>
              
              {/* Queue sidebar - desktop only, fixed right side */}
              <QueueSidebar />
              
              {/* Queue panel - mobile/tablet only sheet/drawer */}
              <div className="xl:hidden">
                <QueuePanel />
              </div>
            </div>
            
            {/* Player bar - fixed height at bottom */}
            <div className="shrink-0">
              <PlayerBar />
            </div>
            
            {/* Mobile navigation - fixed at bottom on mobile */}
            <div className="shrink-0 lg:hidden">
              <MobileNav />
            </div>
            
            {/* Fullscreen player - modal overlay */}
            <FullscreenPlayer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
