import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { PlayerBar } from "@/components/layout/player-bar";
import { QueuePanel } from "@/components/queue/queue-panel";
import { FullscreenPlayer } from "@/components/player/fullscreen-player";

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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
          <div className="flex min-h-screen">
            {/* Sidebar - hidden on mobile */}
            <Sidebar />
            
            {/* Main content area */}
            <main className="flex-1 lg:ml-[280px] pb-[88px] lg:pb-[88px] min-h-screen">
              {children}
            </main>
            
            {/* Player bar - always visible */}
            <PlayerBar />
            
            {/* Queue panel - slide-out drawer */}
            <QueuePanel />
            
            {/* Fullscreen player - modal overlay */}
            <FullscreenPlayer />
            
            {/* Mobile navigation - visible on mobile only */}
            <MobileNav />
          </div>
        </Providers>
      </body>
    </html>
  );
}
