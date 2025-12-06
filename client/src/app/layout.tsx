import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Sidebar, SidebarSkeleton } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { PlayerBar } from "@/components/layout/player-bar";
import { QueuePanel, QueueSidebar } from "@/components/queue/queue";
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

// Script that sets the favicon color based on localStorage preferences
// This runs before React to prevent flash of default color on page load
const initFaviconScript = `
(function() {
  try {
    // OKLCH to hex converter (simplified version)
    function oklchToHex(l, c, h) {
      var hRad = (h * Math.PI) / 180;
      var a = c * Math.cos(hRad);
      var b = c * Math.sin(hRad);
      var l_ = l + 0.3963377774 * a + 0.2158037573 * b;
      var m_ = l - 0.1055613458 * a - 0.0638541728 * b;
      var s_ = l - 0.0894841775 * a - 1.2914855480 * b;
      var lCubed = l_ * l_ * l_;
      var mCubed = m_ * m_ * m_;
      var sCubed = s_ * s_ * s_;
      var rLinear = +4.0767416621 * lCubed - 3.3077115913 * mCubed + 0.2309699292 * sCubed;
      var gLinear = -1.2684380046 * lCubed + 2.6097574011 * mCubed - 0.3413193965 * sCubed;
      var bLinear = -0.0041960863 * lCubed - 0.7034186147 * mCubed + 1.7076147010 * sCubed;
      function gammaCorrect(c) {
        return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1/2.4) - 0.055;
      }
      function toHex(x) {
        var clamped = Math.max(0, Math.min(255, Math.round(x * 255)));
        var hex = clamped.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      }
      return '#' + toHex(gammaCorrect(rLinear)) + toHex(gammaCorrect(gLinear)) + toHex(gammaCorrect(bLinear));
    }

    // Preset color definitions
    var presets = {
      rust: { l: 0.65, c: 0.16, h: 45 },
      gold: { l: 0.75, c: 0.15, h: 85 },
      lime: { l: 0.75, c: 0.18, h: 125 },
      emerald: { l: 0.65, c: 0.18, h: 160 },
      teal: { l: 0.7, c: 0.15, h: 195 },
      ocean: { l: 0.6, c: 0.16, h: 230 },
      indigo: { l: 0.6, c: 0.18, h: 265 },
      violet: { l: 0.65, c: 0.2, h: 300 },
      rose: { l: 0.65, c: 0.2, h: 340 },
      crimson: { l: 0.6, c: 0.22, h: 15 }
    };

    // Read preferences from localStorage
    var accentColor = localStorage.getItem('ferrotune-accent-color');
    if (accentColor) accentColor = JSON.parse(accentColor);
    if (!accentColor) accentColor = 'rust';

    var l, c, h;
    if (accentColor === 'custom') {
      h = localStorage.getItem('ferrotune-custom-accent-hue');
      l = localStorage.getItem('ferrotune-custom-accent-lightness');
      c = localStorage.getItem('ferrotune-custom-accent-chroma');
      h = h ? JSON.parse(h) : 45;
      l = l ? JSON.parse(l) : 0.65;
      c = c ? JSON.parse(c) : 0.18;
    } else {
      var preset = presets[accentColor] || presets.rust;
      l = preset.l;
      c = preset.c;
      h = preset.h;
    }

    var hexColor = oklchToHex(l, c, h);

    // Generate SVG favicon
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
      '<rect x="0" y="0" width="512" height="512" rx="96" fill="' + hexColor + '"/>' +
      '<g transform="translate(96, 96) scale(13.33)" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none">' +
      '<path d="M9 18V5"/>' +
      '<path d="M21 16V3"/>' +
      '<path d="M9 5l12-2"/>' +
      '<circle cx="6" cy="18" r="3"/>' +
      '<circle cx="18" cy="16" r="3"/>' +
      '</g></svg>';

    var dataUrl = 'data:image/svg+xml;base64,' + btoa(svg);

    // Find and update existing icon link, or create one
    var iconLink = document.querySelector("link[rel='icon']");
    if (iconLink) {
      iconLink.href = dataUrl;
    } else {
      var link = document.createElement('link');
      link.rel = 'icon';
      link.type = 'image/svg+xml';
      link.href = dataUrl;
      document.head.appendChild(link);
    }
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
  // Note: favicon is dynamically generated from initFaviconScript based on user's accent color preference
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
        {/* Inject script to set favicon color from localStorage before React hydration */}
        <script dangerouslySetInnerHTML={{ __html: initFaviconScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased overflow-hidden`}
      >
        <Providers>
          <div className="h-screen flex flex-col">
            {/* Main container - takes up all space except footer */}
            <div className="flex flex-1 min-h-0">
              {/* Sidebar - hidden on mobile, spans full height of main container */}
              <Suspense fallback={<SidebarSkeleton />}>
                <Sidebar />
              </Suspense>
              
              {/* Main content area - uses MainContent wrapper for responsive margins */}
              <MainContent>
                {children}
              </MainContent>
              
              {/* Queue sidebar - desktop only, fixed right side, spans full height of main container */}
              <QueueSidebar />
              
              {/* Queue panel - mobile/tablet only sheet/drawer */}
              <div className="xl:hidden">
                <QueuePanel />
              </div>
            </div>
            
            {/* Footer section - player bar and mobile nav */}
            <div className="shrink-0">
              {/* Player bar */}
              <PlayerBar />
              
              {/* Mobile navigation - only on mobile */}
              <div className="lg:hidden">
                <MobileNav />
              </div>
            </div>
            
            {/* Fullscreen player - modal overlay */}
            <FullscreenPlayer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
