"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider as JotaiProvider, useAtomValue } from "jotai";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { useState, useEffect, Suspense } from "react";
import { useAudioEngineInit, useMediaSession } from "@/lib/audio/hooks";
import { useKeyboardShortcuts } from "@/lib/hooks/use-keyboard-shortcuts";
import { useDocumentTitle } from "@/lib/hooks/use-document-title";
import { usePreferencesSync } from "@/lib/hooks/use-preferences-sync";
import { useClearSelectionOnNavigate } from "@/lib/hooks/use-clear-selection-on-navigate";
import { DynamicFavicon } from "@/components/dynamic-favicon";
import { accentColorAtom, customAccentHueAtom, customAccentLightnessAtom, customAccentChromaAtom } from "@/lib/store/ui";

// Component that handles clearing selection on navigation
// Wrapped in Suspense because useSearchParams triggers Suspense on initial render
function SelectionClearer() {
  useClearSelectionOnNavigate();
  return null;
}

// Component that initializes the audio engine and media session
function AudioEngineProvider({ children }: { children: React.ReactNode }) {
  useAudioEngineInit();
  useMediaSession();
  useKeyboardShortcuts();
  useDocumentTitle();
  usePreferencesSync(); // Load and sync user preferences from server
  return <>{children}</>;
}

// Component that applies accent color
function AccentColorProvider({ children }: { children: React.ReactNode }) {
  const accentColor = useAtomValue(accentColorAtom);
  const customHue = useAtomValue(customAccentHueAtom);
  const customLightness = useAtomValue(customAccentLightnessAtom);
  const customChroma = useAtomValue(customAccentChromaAtom);
  
  useEffect(() => {
    const html = document.documentElement;
    // Remove any previous accent attribute
    html.removeAttribute("data-accent");
    
    // Clear any custom CSS variables
    html.style.removeProperty("--primary");
    html.style.removeProperty("--ring");
    html.style.removeProperty("--chart-1");
    html.style.removeProperty("--sidebar-primary");
    html.style.removeProperty("--sidebar-ring");
    
    if (accentColor === "custom") {
      // Apply custom color via inline CSS variables
      const customColor = `oklch(${customLightness} ${customChroma} ${customHue})`;
      html.style.setProperty("--primary", customColor);
      html.style.setProperty("--ring", customColor);
      html.style.setProperty("--chart-1", customColor);
      html.style.setProperty("--sidebar-primary", customColor);
      html.style.setProperty("--sidebar-ring", customColor);
    } else if (accentColor !== "rust") {
      // Set data attribute for preset themes (rust is the default, handled by CSS variables directly)
      html.setAttribute("data-accent", accentColor);
    }
  }, [accentColor, customHue, customLightness, customChroma]);
  
  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={true}
          disableTransitionOnChange
        >
            <AccentColorProvider>
              <DynamicFavicon />
              <Suspense fallback={null}>
                <SelectionClearer />
              </Suspense>
              <AudioEngineProvider>
                {children}
              </AudioEngineProvider>
            </AccentColorProvider>
          <Toaster 
            position="bottom-right" 
            richColors 
            offset={100}
            toastOptions={{
              style: {
                // Match right margin to bottom offset (footer height)
                marginRight: '16px',
              }
            }}
          />
        </ThemeProvider>
      </QueryClientProvider>
    </JotaiProvider>
  );
}
