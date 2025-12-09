"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Folder,
  FolderOpen,
  ChevronRight,
  Home,
  RefreshCw,
  AlertCircle,
  Loader2,
  Check,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getClient } from "@/lib/api/client";
import type { DirectoryEntry } from "@/lib/api/generated/DirectoryEntry";

interface DirectoryBrowserProps {
  /** Currently entered/selected path */
  value: string;
  /** Called when the path changes */
  onChange: (path: string) => void;
  /** Called when a path is selected (confirmed) */
  onSelect?: (path: string) => void;
  /** Whether to show the directory browser panel */
  showBrowser?: boolean;
  /** Placeholder text for the input */
  placeholder?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Error message to display */
  error?: string | null;
}

export function DirectoryBrowser({
  value,
  onChange,
  onSelect,
  showBrowser = true,
  placeholder = "/path/to/music",
  disabled = false,
  error,
}: DirectoryBrowserProps) {
  const [browserPath, setBrowserPath] = useState<string>("");
  const [isExpanded, setIsExpanded] = useState(false);

  // Fetch directory contents
  const {
    data: browserData,
    isLoading,
    error: fetchError,
    refetch,
  } = useQuery({
    queryKey: ["filesystem", browserPath],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.browseFilesystem(browserPath || undefined);
    },
    enabled: showBrowser && isExpanded,
    retry: false,
  });

  // Validate the current path
  const { data: validationResult, isLoading: isValidating } = useQuery({
    queryKey: ["validatePath", value],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.validatePath(value);
    },
    enabled: !!value && value.length > 0,
    retry: false,
  });

  // Navigate to a directory in the browser
  const navigateTo = (path: string) => {
    setBrowserPath(path);
  };

  // Select a directory
  const selectDirectory = (entry: DirectoryEntry) => {
    onChange(entry.path);
    if (onSelect) {
      onSelect(entry.path);
    }
    setIsExpanded(false);
  };

  // Use the current browser path as the value
  const useCurrentPath = () => {
    if (browserPath) {
      onChange(browserPath);
      if (onSelect) {
        onSelect(browserPath);
      }
      setIsExpanded(false);
    }
  };

  return (
    <div className="space-y-2">
      {/* Path input with validation indicator */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            placeholder={placeholder}
            className="font-mono text-sm pr-10"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          />
          {/* Validation indicator */}
          {value && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {isValidating ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              ) : validationResult?.valid ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <X className="w-4 h-4 text-destructive" />
              )}
            </div>
          )}
        </div>
        {showBrowser && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsExpanded(!isExpanded)}
            disabled={disabled}
          >
            <Folder className="w-4 h-4 mr-2" />
            Browse
          </Button>
        )}
      </div>

      {/* Validation error message */}
      {value && validationResult && !validationResult.valid && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {validationResult.error}
        </p>
      )}

      {/* External error message */}
      {error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {error}
        </p>
      )}

      {/* Directory browser panel */}
      {showBrowser && isExpanded && (
        <div className="border rounded-lg overflow-hidden bg-muted/30">
          {/* Breadcrumb navigation */}
          <div className="flex items-center gap-1 p-2 border-b bg-muted/50 overflow-x-auto">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 shrink-0"
              onClick={() => navigateTo("")}
            >
              <Home className="w-4 h-4" />
            </Button>
            {browserData?.breadcrumbs?.map((crumb) => (
              <div key={crumb.path} className="flex items-center shrink-0">
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => navigateTo(crumb.path)}
                >
                  {crumb.name}
                </Button>
              </div>
            ))}
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => refetch()}
              disabled={isLoading}
            >
              <RefreshCw
                className={cn("w-4 h-4", isLoading && "animate-spin")}
              />
            </Button>
          </div>

          {/* Directory listing */}
          <ScrollArea className="h-48">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : fetchError ? (
              <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                <AlertCircle className="w-6 h-6 text-destructive mb-2" />
                <p className="text-sm text-destructive">
                  {fetchError instanceof Error
                    ? fetchError.message
                    : "Failed to load directory"}
                </p>
              </div>
            ) : browserData?.directories?.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                No subdirectories
              </div>
            ) : (
              <div className="p-1">
                {browserData?.directories?.map((entry) => (
                  <div
                    key={entry.path}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer",
                      "hover:bg-accent/50 transition-colors",
                      !entry.readable && "opacity-50",
                    )}
                  >
                    {/* Double-click to navigate, single click to select */}
                    <button
                      className="flex items-center gap-2 flex-1 min-w-0 text-left"
                      onClick={() => selectDirectory(entry)}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        if (entry.readable) {
                          navigateTo(entry.path);
                        }
                      }}
                      disabled={!entry.readable}
                    >
                      {entry.readable ? (
                        <FolderOpen className="w-4 h-4 text-primary shrink-0" />
                      ) : (
                        <Folder className="w-4 h-4 text-muted-foreground shrink-0" />
                      )}
                      <span className="truncate text-sm">{entry.name}</span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() => {
                        if (entry.readable) {
                          navigateTo(entry.path);
                        }
                      }}
                      disabled={!entry.readable}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Use current directory button */}
          {browserPath && (
            <div className="p-2 border-t bg-muted/50">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={useCurrentPath}
              >
                <Check className="w-4 h-4 mr-2" />
                Use: {browserPath}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
