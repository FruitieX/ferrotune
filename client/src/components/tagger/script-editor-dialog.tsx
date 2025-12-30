"use client";

import { useState, useRef } from "react";
import { useAtom, useAtomValue } from "jotai";
import { Play, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import Editor, { OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import {
  taggerScriptsAtom,
  taggerTracksAtom,
  taggerSelectedIdsAtom,
  taggerFocusedRowIdAtom,
  TaggerScript,
  getTrackTags,
} from "@/lib/store/tagger";

interface ScriptEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scriptId?: string | null;
  scriptType?: "rename" | "tags";
  onRenameScriptSaved?: (scriptId: string) => void;
  /** One-off mode: show Run button instead of Save, and script runs on selected tracks */
  oneOffMode?: boolean;
  /** Callback for running a one-off script (receives the script code) */
  onRunOnce?: (code: string, type: "rename" | "tags") => void;
}

// Tag variable names for autocomplete and hover
const TAG_VARIABLES = [
  { name: "title", desc: "Track title from metadata", type: "string" },
  { name: "artist", desc: "Artist name from metadata", type: "string" },
  {
    name: "albumartist",
    desc: "Album artist (often different from track artist for compilations)",
    type: "string",
  },
  { name: "album", desc: "Album name from metadata", type: "string" },
  { name: "genre", desc: "Genre tag", type: "string" },
  { name: "year", desc: "Release year", type: "string" },
  {
    name: "tracknumber",
    desc: "Track number within the album (as string, e.g. '1' or '01')",
    type: "string",
  },
  {
    name: "tracktotal",
    desc: "Total number of tracks on the album",
    type: "string",
  },
  {
    name: "discnumber",
    desc: "Disc number for multi-disc albums",
    type: "string",
  },
  { name: "disctotal", desc: "Total number of discs", type: "string" },
  { name: "comment", desc: "Comment/notes tag", type: "string" },
  { name: "composer", desc: "Composer name", type: "string" },
  {
    name: "ext",
    desc: "File extension without the dot (e.g. 'flac', 'mp3')",
    type: "string",
  },
  {
    name: "filename",
    desc: "Filename without path and extension",
    type: "string",
  },
  { name: "filepath", desc: "Full file path", type: "string" },
];

interface PreviewResult {
  id: string;
  input: string;
  output: string;
  // For tag scripts, show diff of changes
  changes?: Array<{ key: string; oldValue: string; newValue: string }>;
  error?: string;
}

function getDefaultScript(t: "rename" | "tags", oneOff = false): string {
  if (t === "rename") {
    return `// Rename Script: Returns an array of path segments
// Available: title, artist, albumartist, album, genre, year,
// tracknumber, tracktotal, discnumber, disctotal, ext, filename
// Return: array of path segments (artist, album, filename)
// Dangerous chars are auto-sanitized per your settings

const albumArtist = albumartist || artist || 'Unknown Artist';
const albumFolder = album || 'Unknown Album';
const trackArtist = artist || 'Unknown Artist';
const trackTitle = title || 'Unknown Title';
const trackNum = tracknumber ? tracknumber.padStart(2, '0') + ' - ' : '';

return [
  albumArtist,
  albumFolder,
  trackNum + trackArtist + ' - ' + trackTitle + '.' + ext
];`;
  } else if (oneOff) {
    // One-off script sample: demonstrates common tag operations
    return `// One-off Script: Modify tags using JavaScript
// All variables (title, artist, album, etc.) are available as strings
// Return an object with the tags you want to update

// Example 1: Parse Artist - Title from filename
// const match = filename.match(/^(.+?)\\s*-\\s*(.+)$/);
// if (match) {
//   return { artist: match[1].trim(), title: match[2].trim() };
// }

// Example 2: Extract track number from filename
// const numMatch = filename.match(/^(\\d+)/);
// if (numMatch) {
//   return { tracknumber: numMatch[1] };
// }

// Example 3: Bulk update a field
// return { genre: 'Electronic' };

// Your code here:
return {};`;
  } else {
    return `// Available: filename, ext, and all current tags (title, artist, album, etc.)
// Return: object with tag values to update
const parts = filename.split(' - ');
if (parts.length >= 2) {
  return {
    artist: parts[0].trim(),
    title: parts.slice(1).join(' - ').trim()
  };
}
return {};`;
  }
}

export function ScriptEditorDialog({
  open,
  onOpenChange,
  scriptId,
  scriptType = "rename",
  onRenameScriptSaved,
  oneOffMode = false,
  onRunOnce,
}: ScriptEditorDialogProps) {
  const [scripts, setScripts] = useAtom(taggerScriptsAtom);
  const tracks = useAtomValue(taggerTracksAtom);
  const selectedIds = useAtomValue(taggerSelectedIdsAtom);
  const focusedRowId = useAtomValue(taggerFocusedRowIdAtom);

  // State for tracking synced values - using prevProps pattern recommended by React
  const [syncedProps, setSyncedProps] = useState<{
    scriptId: string | null | undefined;
    wasOpen: boolean;
    wasOneOffMode: boolean;
  }>({ scriptId: undefined, wasOpen: false, wasOneOffMode: false });

  const [name, setName] = useState("New Script");
  const [type, setType] = useState<"rename" | "tags">(scriptType);
  const [code, setCode] = useState(getDefaultScript(scriptType, oneOffMode));
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);

  // Find existing script
  const existingScript = scripts.find((s) => s.id === scriptId);

  // Sync state when scriptId, open state, or oneOffMode changes (React-recommended pattern)
  const needsSync =
    (open && !syncedProps.wasOpen) || // Dialog just opened
    (open && scriptId !== syncedProps.scriptId) || // ScriptId changed while open
    (open && oneOffMode !== syncedProps.wasOneOffMode); // OneOffMode changed while open

  if (needsSync) {
    setSyncedProps({ scriptId, wasOpen: open, wasOneOffMode: oneOffMode });
    if (existingScript && !oneOffMode) {
      setName(existingScript.name);
      setType(existingScript.type);
      setCode(existingScript.script);
    } else if (oneOffMode) {
      // One-off mode: always start with sample script
      setName("One-off Script");
      setType(scriptType);
      setCode(getDefaultScript(scriptType, true));
    } else {
      setName("New Script");
      setType(scriptType);
      setCode(getDefaultScript(scriptType, false));
    }
  } else if (!open && syncedProps.wasOpen) {
    // Dialog just closed - reset tracking for next open
    setSyncedProps({
      scriptId: undefined,
      wasOpen: false,
      wasOneOffMode: false,
    });
  }

  // Check if there are unsaved changes (not relevant for one-off mode)
  const hasUnsavedChanges = oneOffMode
    ? false
    : existingScript
      ? name !== existingScript.name ||
        type !== existingScript.type ||
        code !== existingScript.script
      : name !== "New Script" ||
        type !== scriptType ||
        code !== getDefaultScript(scriptType);

  // Get selected tracks for preview - same logic as details panel
  const getPreviewTracks = () => {
    // Prioritize checkbox selections
    let previewTracks = Array.from(selectedIds)
      .map((id) => tracks.get(id))
      .filter((t) => t !== undefined);

    // Fall back to focused row
    if (previewTracks.length === 0 && focusedRowId) {
      const focusedTrack = tracks.get(focusedRowId);
      if (focusedTrack) {
        previewTracks = [focusedTrack];
      }
    }

    // Fall back to first 5 tracks
    if (previewTracks.length === 0) {
      previewTracks = Array.from(tracks.values()).slice(0, 5);
    }

    return previewTracks.slice(0, 5);
  };

  // Compute preview directly during render (React Compiler handles memoization)
  const previewData = (() => {
    if (!open)
      return { results: [] as PreviewResult[], error: null as string | null };

    const results: PreviewResult[] = [];
    let firstError: string | null = null;

    const previewTracks = getPreviewTracks();

    for (const trackState of previewTracks) {
      const tags = getTrackTags(trackState);
      const filePath = trackState.track.filePath;
      const parts = filePath.split("/");
      const fullFilename = parts[parts.length - 1];
      const dotIdx = fullFilename.lastIndexOf(".");
      const filename =
        dotIdx > 0 ? fullFilename.slice(0, dotIdx) : fullFilename;
      const ext = dotIdx > 0 ? fullFilename.slice(dotIdx + 1) : "";

      try {
        // Build context object
        const context: Record<string, string> = {
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
        };

        // Create function and execute
        const fn = new Function(...Object.keys(context), code);
        const result = fn(...Object.values(context));

        if (type === "rename") {
          results.push({
            id: trackState.track.id,
            input: fullFilename,
            output: String(result ?? ""),
          });
        } else {
          // For tag scripts, show a diff of changes
          const changes: Array<{
            key: string;
            oldValue: string;
            newValue: string;
          }> = [];
          if (result && typeof result === "object") {
            for (const [key, value] of Object.entries(result)) {
              if (typeof value === "string") {
                const normalizedKey = key.toUpperCase();
                const oldValue = tags[normalizedKey] ?? "";
                if (value !== oldValue) {
                  changes.push({
                    key: normalizedKey,
                    oldValue: oldValue || "(empty)",
                    newValue: value || "(empty)",
                  });
                }
              }
            }
          }
          results.push({
            id: trackState.track.id,
            input: `${tags.TITLE || "(no title)"} - ${tags.ARTIST || "(no artist)"}`,
            output: "",
            changes,
          });
        }
      } catch (e) {
        results.push({
          id: trackState.track.id,
          input: fullFilename,
          output: "",
          error: String(e),
        });
        if (!firstError) {
          firstError = String(e);
        }
      }
    }

    return { results, error: firstError };
  })();

  const preview = previewData.results;
  const previewError = previewData.error;

  function handleSave() {
    const newScriptId = scriptId ?? `script-${Date.now()}`;
    const newScript: TaggerScript = {
      id: newScriptId,
      name,
      type,
      script: code,
    };

    if (scriptId && existingScript) {
      setScripts(scripts.map((s) => (s.id === scriptId ? newScript : s)));
    } else {
      setScripts([...scripts, newScript]);
    }

    // Notify parent if this is a rename script so paths can be recalculated
    if (type === "rename" && onRenameScriptSaved) {
      onRenameScriptSaved(newScriptId);
    }

    onOpenChange(false);
  }

  // Handle close - check for unsaved changes
  function handleClose() {
    if (hasUnsavedChanges) {
      setShowCloseConfirm(true);
    } else {
      onOpenChange(false);
    }
  }

  // Intercept dialog close requests
  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) {
      handleClose();
    } else {
      onOpenChange(true);
    }
  }

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Custom keybindings - prevent Escape from closing dialog when used in editor
    editor.addCommand(monaco.KeyCode.Escape, () => {
      // Do nothing - escape should not close the dialog
      // It can be used to close autocomplete, etc. within the editor
    });

    // Add TypeScript type declarations for tag variables
    // This provides proper types in the editor instead of 'any'
    const tagVarDeclarations = TAG_VARIABLES.map(
      (v) => `/** ${v.desc} */\ndeclare const ${v.name}: ${v.type};`,
    ).join("\n");

    monaco.languages.typescript.javascriptDefaults.addExtraLib(
      tagVarDeclarations,
      "tagger-variables.d.ts",
    );

    // Register completions for tag variables
    monaco.languages.registerCompletionItemProvider("javascript", {
      provideCompletionItems: (
        model: Monaco.editor.ITextModel,
        position: Monaco.Position,
      ) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        // Create tag variable suggestions with high priority
        const tagSuggestions = TAG_VARIABLES.map((v, index) => ({
          label: v.name,
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: v.name,
          detail: `${v.type} - ${v.desc}`,
          range,
          // Use sortText to ensure tag variables appear first
          sortText: `0000${String(index).padStart(4, "0")}`,
          // Higher priority than built-in suggestions
          preselect: index === 0,
        }));

        return { suggestions: tagSuggestions };
      },
    });

    // Register hover provider for tag variables
    monaco.languages.registerHoverProvider("javascript", {
      provideHover: (
        model: Monaco.editor.ITextModel,
        position: Monaco.Position,
      ) => {
        const word = model.getWordAtPosition(position);
        if (!word) return null;

        const tagVar = TAG_VARIABLES.find((v) => v.name === word.word);
        if (!tagVar) return null;

        return {
          range: {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          },
          contents: [
            { value: `**${tagVar.name}**: ${tagVar.type}` },
            { value: tagVar.desc },
          ],
        };
      },
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="sm:max-w-[1440px] h-[80vh] flex flex-col"
          onEscapeKeyDown={(e) => {
            // Prevent Escape from closing dialog - let the editor handle it
            // for closing autocomplete, hover widgets, etc.
            e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {oneOffMode
                ? "Run One-off Script"
                : scriptId
                  ? "Edit Script"
                  : "New Script"}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 flex gap-4 min-h-0">
            {/* Editor Side */}
            <div className="flex-1 flex flex-col min-w-0">
              {!oneOffMode && (
                <div className="flex gap-2 mb-2">
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground">
                      Name
                    </Label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="h-8"
                    />
                  </div>
                  <div className="w-40">
                    <Label className="text-xs text-muted-foreground">
                      Type
                    </Label>
                    <Select
                      value={type}
                      onValueChange={(v: "rename" | "tags") => {
                        setType(v);
                        if (!scriptId) {
                          setCode(getDefaultScript(v));
                        }
                      }}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rename">File Rename</SelectItem>
                        <SelectItem value="tags">Tag Script</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              {oneOffMode && (
                <div className="mb-2 text-xs text-muted-foreground">
                  Edit the script below and click &quot;Run on Selected&quot; to
                  apply it to the selected tracks. This script won&apos;t be
                  saved.
                </div>
              )}

              <div className="flex-1 border rounded overflow-hidden">
                <Editor
                  height="100%"
                  language="javascript"
                  theme="vs-dark"
                  value={code}
                  onChange={(v) => setCode(v ?? "")}
                  onMount={handleEditorMount}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                    // Limit suggestions to show tag variables prominently
                    suggestSelection: "first",
                    suggest: {
                      showWords: false,
                      showClasses: false,
                      showInterfaces: false,
                      showModules: false,
                      showProperties: true,
                      showVariables: true,
                      showFunctions: true,
                      showConstants: true,
                    },
                  }}
                />
              </div>

              {previewError && (
                <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-500 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="flex-1">{previewError}</span>
                </div>
              )}
            </div>

            {/* Preview Side */}
            <div className="w-80 flex flex-col border rounded bg-muted/30">
              <div className="p-2 border-b flex items-center gap-2">
                <Play className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Preview</span>
              </div>
              <div className="flex-1 overflow-auto p-2 space-y-2">
                {preview.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    Load tracks to see preview
                  </p>
                )}
                {preview.map((p) => (
                  <div
                    key={p.id}
                    className="p-2 bg-background rounded border text-xs"
                  >
                    <div className="text-muted-foreground truncate mb-1">
                      {p.input}
                    </div>
                    {p.error ? (
                      <div className="text-red-500">{p.error}</div>
                    ) : type === "tags" && p.changes ? (
                      // Show diff for tag scripts
                      <div className="space-y-1">
                        {p.changes.length === 0 ? (
                          <div className="text-muted-foreground italic">
                            No changes
                          </div>
                        ) : (
                          p.changes.map(({ key, oldValue, newValue }) => (
                            <div
                              key={key}
                              className="flex items-center gap-1 text-xs"
                            >
                              <span className="font-medium text-muted-foreground w-20 truncate shrink-0">
                                {key}:
                              </span>
                              <span className="text-red-500 line-through truncate max-w-16">
                                {oldValue}
                              </span>
                              <span className="text-muted-foreground">→</span>
                              <span className="text-green-500 truncate max-w-16">
                                {newValue}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    ) : (
                      <div className="text-foreground font-mono whitespace-pre-wrap break-all">
                        {p.output || "(empty)"}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            {oneOffMode ? (
              <Button
                onClick={() => {
                  onRunOnce?.(code, type);
                  onOpenChange(false);
                }}
              >
                Run on Selected
              </Button>
            ) : (
              <Button onClick={handleSave}>Save Script</Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Unsaved changes confirmation */}
      <AlertDialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Are you sure you want to close the
              editor? Your changes will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue Editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowCloseConfirm(false);
                onOpenChange(false);
              }}
            >
              Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
