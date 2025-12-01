"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider as JotaiProvider, useAtomValue } from "jotai";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { useState, useEffect } from "react";
import { useAudioEngineInit, useMediaSession } from "@/lib/audio/hooks";
import { useKeyboardShortcuts } from "@/lib/hooks/use-keyboard-shortcuts";
import { useQueuePersistence } from "@/lib/hooks/use-queue-persistence";
import { accentColorAtom } from "@/lib/store/ui";

// Component that initializes the audio engine and media session
function AudioEngineProvider({ children }: { children: React.ReactNode }) {
  useAudioEngineInit();
  useMediaSession();
  useKeyboardShortcuts();
  useQueuePersistence();
  return <>{children}</>;
}

// Component that applies accent color
function AccentColorProvider({ children }: { children: React.ReactNode }) {
  const accentColor = useAtomValue(accentColorAtom);
  
  useEffect(() => {
    const html = document.documentElement;
    // Remove any previous accent attribute
    html.removeAttribute("data-accent");
    // Set new accent (rust is the default, handled by CSS variables directly)
    if (accentColor !== "rust") {
      html.setAttribute("data-accent", accentColor);
    }
  }, [accentColor]);
  
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
            <AudioEngineProvider>
              {children}
            </AudioEngineProvider>
          </AccentColorProvider>
          <Toaster position="bottom-right" richColors offset={100} />
        </ThemeProvider>
      </QueryClientProvider>
    </JotaiProvider>
  );
}
