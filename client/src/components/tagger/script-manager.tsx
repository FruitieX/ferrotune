"use client";

import { useAtom, useAtomValue } from "jotai";
import {
  FileCode,
  Plus,
  Edit,
  Trash2,
  Play,
  Check,
  Circle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  taggerScriptsAtom,
  taggerSessionAtom,
  taggerTracksAtom,
  taggerSelectedIdsAtom,
  taggerFocusedRowIdAtom,
  TaggerScript,
  getTrackTags,
} from "@/lib/store/tagger";
import { useRenameScript } from "@/lib/hooks/use-rename-script";
import { ScriptEditorDialog } from "./script-editor-dialog";
import { useState } from "react";
import { toast } from "sonner";

export function ScriptManager() {
  const [scripts, setScripts] = useAtom(taggerScriptsAtom);
  const [session, setSession] = useAtom(taggerSessionAtom);
  const [tracks, setTracks] = useAtom(taggerTracksAtom);
  const selectedIds = useAtomValue(taggerSelectedIdsAtom);
  const focusedRowId = useAtomValue(taggerFocusedRowIdAtom);
  const { runOnAllTracks } = useRenameScript();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
  const [newScriptType, setNewScriptType] = useState<"rename" | "tags">(
    "rename",
  );

  const renameScripts = scripts.filter((s) => s.type === "rename");
  const tagScripts = scripts.filter((s) => s.type === "tags");

  function openNewScript(type: "rename" | "tags") {
    setEditingScriptId(null);
    setNewScriptType(type);
    setEditorOpen(true);
  }

  function openEditScript(id: string) {
    setEditingScriptId(id);
    setEditorOpen(true);
  }

  function deleteScript(id: string) {
    // If deleting the active rename script, deactivate it
    if (session.activeRenameScriptId === id) {
      setSession({ ...session, activeRenameScriptId: null });
      // Clear all computed paths
      setTracks((prev) => {
        const newTracks = new Map(prev);
        for (const [trackId, state] of newTracks) {
          if (state.computedPath) {
            newTracks.set(trackId, { ...state, computedPath: null });
          }
        }
        return newTracks;
      });
    }
    setScripts(scripts.filter((s) => s.id !== id));
  }

  function buildContext(
    state: ReturnType<typeof tracks.get>,
  ): Record<string, string> | null {
    if (!state) return null;

    const tags = getTrackTags(state);
    const filePath = state.track.filePath;
    const parts = filePath.split("/");
    const fullFilename = parts[parts.length - 1];
    const dotIdx = fullFilename.lastIndexOf(".");
    const filename = dotIdx > 0 ? fullFilename.slice(0, dotIdx) : fullFilename;
    const ext = dotIdx > 0 ? fullFilename.slice(dotIdx + 1) : "";

    return {
      filename,
      ext,
      title: tags.TITLE ?? "",
      artist: tags.ARTIST ?? "",
      albumartist: tags.ALBUMARTIST ?? "",
      album: tags.ALBUM ?? "",
      genre: tags.GENRE ?? "",
      year: tags.YEAR ?? "",
      tracknumber: tags.TRACKNUMBER ?? "",
      tracktotal: tags.TRACKTOTAL ?? "",
      discnumber: tags.DISCNUMBER ?? "",
      disctotal: tags.DISCTOTAL ?? "",
      comment: tags.COMMENT ?? "",
      composer: tags.COMPOSER ?? "",
    };
  }

  // Activate/deactivate a rename script
  function toggleRenameScript(scriptId: string) {
    const isActive = session.activeRenameScriptId === scriptId;

    if (isActive) {
      // Deactivate - clear the selection
      setSession({ ...session, activeRenameScriptId: null });
      // Clear all computed paths
      setTracks((prev) => {
        const newTracks = new Map(prev);
        for (const [trackId, state] of newTracks) {
          if (state.computedPath) {
            newTracks.set(trackId, { ...state, computedPath: null });
          }
        }
        return newTracks;
      });
    } else {
      // Activate - run the script on all tracks
      setSession({ ...session, activeRenameScriptId: scriptId });
      runRenameScriptOnAllTracks(scriptId);
    }
  }

  // Characters that are dangerous in filenames across platforms
  const DANGEROUS_CHARS_REGEX = /[\\/:*?"<>|\x00]/g;

  // Sanitize a path segment based on dangerous char mode
  function sanitizePathSegment(
    segment: string,
    mode: "ignore" | "strip" | "replace",
    replacement: string,
  ): string {
    if (mode === "ignore") return segment;
    if (mode === "strip") return segment.replace(DANGEROUS_CHARS_REGEX, "");
    return segment.replace(DANGEROUS_CHARS_REGEX, replacement);
  }

  // Process script result (string or array)
  function processScriptResult(
    result: unknown,
    mode: "ignore" | "strip" | "replace",
    replacement: string,
  ): string | null {
    if (Array.isArray(result)) {
      // New format: array of path segments
      const sanitizedSegments = result
        .filter((seg) => typeof seg === "string" && seg.trim())
        .map((seg) => sanitizePathSegment(seg as string, mode, replacement));
      if (sanitizedSegments.length === 0) return null;
      return sanitizedSegments.join("/");
    } else if (typeof result === "string" && result.trim()) {
      // Legacy format: string with forward slashes
      const segments = result.split("/").filter((s) => s.trim());
      const sanitizedSegments = segments.map((seg) =>
        sanitizePathSegment(seg, mode, replacement),
      );
      if (sanitizedSegments.length === 0) return null;
      return sanitizedSegments.join("/");
    }
    return null;
  }

  // Run a rename script on all tracks
  function runRenameScriptOnAllTracks(scriptId: string) {
    const script = scripts.find((s) => s.id === scriptId);
    if (!script) return;

    const dangerousCharMode = session.dangerousCharMode ?? "replace";
    const dangerousCharReplacement = session.dangerousCharReplacement ?? "_";

    const newTracks = new Map(tracks);
    let successCount = 0;
    let errorCount = 0;

    for (const [id, state] of newTracks) {
      const context = buildContext(state);
      if (!context) continue;

      try {
        const fn = new Function(...Object.keys(context), script.script);
        const result = fn(...Object.values(context));

        const computedPath = processScriptResult(
          result,
          dangerousCharMode,
          dangerousCharReplacement,
        );

        if (computedPath) {
          newTracks.set(id, {
            ...state,
            computedPath,
          });
          successCount++;
        } else {
          // If script returns empty/invalid, keep original
          newTracks.set(id, {
            ...state,
            computedPath: null,
          });
        }
      } catch {
        errorCount++;
        // Keep original path on error
        newTracks.set(id, {
          ...state,
          computedPath: null,
        });
      }
    }

    setTracks(newTracks);

    if (errorCount > 0) {
      toast.warning(
        `Rename script applied to ${successCount} tracks, ${errorCount} errors`,
      );
    }
  }

  // Apply tag script to selected tracks (manually triggered)
  function applyTagScript(script: TaggerScript) {
    // Get selected tracks - same logic as details panel
    let targetIds = Array.from(selectedIds);

    // Fall back to focused row if no selection
    if (targetIds.length === 0 && focusedRowId) {
      targetIds = [focusedRowId];
    }

    // No selection at all
    if (targetIds.length === 0) {
      toast.error("No tracks selected", {
        description:
          "Select tracks using the checkboxes or click a row to apply the script",
      });
      return;
    }

    const newTracks = new Map(tracks);
    let changedCount = 0;

    for (const id of targetIds) {
      const state = newTracks.get(id);
      const context = buildContext(state);
      if (!state || !context) continue;

      try {
        const fn = new Function(...Object.keys(context), script.script);
        const result = fn(...Object.values(context));

        if (result && typeof result === "object") {
          const newEditedTags = { ...state.editedTags };
          let hasChanges = false;

          for (const [key, value] of Object.entries(result)) {
            if (typeof value === "string") {
              const normalizedKey = key.toUpperCase();
              const originalTag = state.track.tags.find(
                (t) => t.key === normalizedKey,
              );
              const originalValue = originalTag?.value ?? "";

              if (value !== originalValue) {
                newEditedTags[normalizedKey] = value;
                hasChanges = true;
              } else {
                delete newEditedTags[normalizedKey];
              }
            }
          }

          if (hasChanges) {
            changedCount++;
          }

          newTracks.set(id, {
            ...state,
            editedTags: newEditedTags,
          });
        }
      } catch (e) {
        // Skip on error - could show a toast for individual errors
        console.error(`Script error on track ${id}:`, e);
      }
    }

    setTracks(newTracks);
    toast.success(`Applied "${script.name}" to ${targetIds.length} track(s)`, {
      description: `${changedCount} track(s) had changes`,
    });
  }

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <FileCode className="w-4 h-4 mr-2" />
            Scripts
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80" align="end">
          <div className="space-y-4">
            {/* Rename Scripts Section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Rename Scripts</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6"
                  onClick={() => openNewScript("rename")}
                >
                  <Plus className="w-3 h-3" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Select one to auto-apply when saving
              </p>
              <div className="space-y-1">
                {renameScripts.map((s) => {
                  const isActive = session.activeRenameScriptId === s.id;
                  return (
                    <div
                      key={s.id}
                      className={`flex items-center gap-1 p-1 rounded cursor-pointer transition-colors ${
                        isActive
                          ? "bg-primary/10 border border-primary/30"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() => toggleRenameScript(s.id)}
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-5 w-5 p-0 ${isActive ? "text-primary" : "text-muted-foreground"}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleRenameScript(s.id);
                            }}
                          >
                            {isActive ? (
                              <Check className="w-3 h-3" />
                            ) : (
                              <Circle className="w-3 h-3" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {isActive ? "Deactivate" : "Activate"}
                        </TooltipContent>
                      </Tooltip>
                      <span className="text-sm flex-1 truncate">{s.name}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditScript(s.id);
                        }}
                      >
                        <Edit className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-red-500"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteScript(s.id);
                        }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  );
                })}
                {renameScripts.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2">
                    No scripts
                  </p>
                )}
              </div>
            </div>

            <div className="border-t" />

            {/* Tag Scripts Section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Tag Scripts</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6"
                  onClick={() => openNewScript("tags")}
                >
                  <Plus className="w-3 h-3" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Apply to selected tracks
              </p>
              <div className="space-y-1">
                {tagScripts.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-1 p-1 rounded hover:bg-muted/50"
                  >
                    <span className="text-sm flex-1 truncate">{s.name}</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => applyTagScript(s)}
                          title="Apply to selected"
                        >
                          <Play className="w-3 h-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Apply to selected tracks</TooltipContent>
                    </Tooltip>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => openEditScript(s.id)}
                    >
                      <Edit className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-red-500"
                      onClick={() => deleteScript(s.id)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
                {tagScripts.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2">
                    No scripts
                  </p>
                )}
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <ScriptEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        scriptId={editingScriptId}
        scriptType={newScriptType}
        onRenameScriptSaved={(scriptId) => {
          // Auto-recalculate paths if this is the active rename script
          if (session.activeRenameScriptId === scriptId) {
            // Use setTimeout to allow scripts state to update first
            setTimeout(() => runOnAllTracks(), 0);
          }
        }}
      />
    </>
  );
}
