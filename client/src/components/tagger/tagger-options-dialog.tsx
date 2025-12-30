"use client";

import { useState, useEffect } from "react";
import { useAtom } from "jotai";
import {
  Settings,
  FileCode,
  Check,
  Circle,
  Plus,
  Edit,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  taggerSessionAtom,
  taggerScriptsAtom,
  taggerTracksAtom,
  type TaggerScript,
} from "@/lib/store/tagger";
import { useRenameScript } from "@/lib/hooks/use-rename-script";
import { ScriptEditorDialog } from "./script-editor-dialog";
import { getClient } from "@/lib/api/client";
import type { MusicFolderInfo } from "@/lib/api/generated";

interface TaggerOptionsDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function TaggerOptionsDialog({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: TaggerOptionsDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const onOpenChange = controlledOnOpenChange ?? setInternalOpen;

  const [session, setSession] = useAtom(taggerSessionAtom);
  const [scripts, setScripts] = useAtom(taggerScriptsAtom);
  const [_tracks, setTracks] = useAtom(taggerTracksAtom);
  const { runOnAllTracks } = useRenameScript();

  // Music folders for library selection
  const [musicFolders, setMusicFolders] = useState<MusicFolderInfo[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);

  // Script editor state
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingScript, setEditingScript] = useState<TaggerScript | null>(null);
  const [newScriptType, setNewScriptType] = useState<"rename" | "tags">(
    "rename",
  );

  // Load music folders
  useEffect(() => {
    if (!open) return;

    const loadFolders = async () => {
      const client = getClient();
      if (!client) return;

      setLoadingFolders(true);
      try {
        const response = await client.getAdminMusicFolders();
        setMusicFolders(response.musicFolders);
      } catch (error) {
        console.error("Failed to load music folders:", error);
      } finally {
        setLoadingFolders(false);
      }
    };

    loadFolders();
  }, [open]);

  // Rename scripts
  const renameScripts = scripts.filter((s) => s.type === "rename");

  function openNewScript(type: "rename" | "tags") {
    setEditingScript(null);
    setNewScriptType(type);
    setIsEditorOpen(true);
  }

  function openEditScript(id: string) {
    const script = scripts.find((s) => s.id === id);
    if (script) {
      setEditingScript(script);
      setNewScriptType(script.type);
      setIsEditorOpen(true);
    }
  }

  function deleteScript(id: string) {
    // Deactivate if active
    if (session.activeRenameScriptId === id) {
      setSession((prev) => ({ ...prev, activeRenameScriptId: null }));
    }
    if (session.activeTagScriptId === id) {
      setSession((prev) => ({ ...prev, activeTagScriptId: null }));
    }
    setScripts((prev) => prev.filter((s) => s.id !== id));
  }

  function toggleRenameScript(scriptId: string) {
    if (session.activeRenameScriptId === scriptId) {
      // Deactivate
      setSession((prev) => ({ ...prev, activeRenameScriptId: null }));
      // Clear computed paths
      setTracks((prev) => {
        const newTracks = new Map(prev);
        for (const [id, state] of newTracks) {
          if (state.computedPath) {
            newTracks.set(id, { ...state, computedPath: null });
          }
        }
        return newTracks;
      });
    } else {
      // Activate new script
      setSession((prev) => ({ ...prev, activeRenameScriptId: scriptId }));
      // Run on all tracks immediately with the specified script ID
      runOnAllTracks(scriptId);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Settings className="w-4 h-4 mr-2" />
            Options
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tagger Options</DialogTitle>
            <DialogDescription>
              Configure tagger behavior and manage scripts
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Library Settings */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium">Library Settings</h3>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="target-library">
                      Target Library for Uploads
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Where to save uploaded files when saving changes
                    </p>
                  </div>
                  <Select
                    value={session.targetLibraryId ?? ""}
                    onValueChange={(value) =>
                      setSession((prev) => ({
                        ...prev,
                        targetLibraryId: value || null,
                      }))
                    }
                    disabled={loadingFolders}
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Select library..." />
                    </SelectTrigger>
                    <SelectContent>
                      {musicFolders.map((folder) => (
                        <SelectItem key={folder.id} value={String(folder.id)}>
                          {folder.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="show-library-prefix">
                      Show Library Paths
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Display library path prefix in file paths
                    </p>
                  </div>
                  <Switch
                    id="show-library-prefix"
                    checked={session.showLibraryPrefix ?? false}
                    onCheckedChange={(checked) =>
                      setSession((prev) => ({
                        ...prev,
                        showLibraryPrefix: checked,
                      }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="show-computed-path">
                      Show Computed Path
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Show renamed path instead of current file path in grid
                    </p>
                  </div>
                  <Switch
                    id="show-computed-path"
                    checked={session.showComputedPath ?? true}
                    onCheckedChange={(checked) =>
                      setSession((prev) => ({
                        ...prev,
                        showComputedPath: checked,
                      }))
                    }
                  />
                </div>

                {/* Dangerous Character Handling */}
                <div className="space-y-2 pt-2 border-t">
                  <div className="space-y-0.5">
                    <Label htmlFor="dangerous-char-mode">
                      Dangerous Characters in Filenames
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Handle characters that are invalid in filenames (\/, :, *,
                      ?, &quot;, &lt;, &gt;, |, NUL)
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={session.dangerousCharMode ?? "replace"}
                      onValueChange={(value: "ignore" | "strip" | "replace") =>
                        setSession((prev) => ({
                          ...prev,
                          dangerousCharMode: value,
                        }))
                      }
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ignore">Ignore (allow)</SelectItem>
                        <SelectItem value="strip">Strip (remove)</SelectItem>
                        <SelectItem value="replace">Replace with</SelectItem>
                      </SelectContent>
                    </Select>
                    {(session.dangerousCharMode ?? "replace") === "replace" && (
                      <Input
                        className="w-16"
                        maxLength={1}
                        value={session.dangerousCharReplacement ?? "_"}
                        onChange={(e) =>
                          setSession((prev) => ({
                            ...prev,
                            dangerousCharReplacement: e.target.value || "_",
                          }))
                        }
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* Rename Scripts */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium">Rename Scripts</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Scripts for generating file paths when saving
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openNewScript("rename")}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  New Script
                </Button>
              </div>

              <div className="space-y-1 max-h-48 overflow-y-auto border rounded-md p-2">
                {renameScripts.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No rename scripts defined
                  </p>
                ) : (
                  renameScripts.map((script) => {
                    const isActive = session.activeRenameScriptId === script.id;
                    return (
                      <div
                        key={script.id}
                        className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50"
                      >
                        <button
                          className="flex items-center gap-2 flex-1 min-w-0 text-left"
                          onClick={() => toggleRenameScript(script.id)}
                        >
                          {isActive ? (
                            <Check className="w-4 h-4 text-primary shrink-0" />
                          ) : (
                            <Circle className="w-4 h-4 text-muted-foreground shrink-0" />
                          )}
                          <span
                            className={`text-sm truncate ${isActive ? "font-medium text-primary" : ""}`}
                          >
                            {script.name}
                          </span>
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => openEditScript(script.id)}
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
                            onClick={() => deleteScript(script.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <Separator />

            {/* Tag Scripts */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium">Tag Scripts</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Scripts for modifying tags based on file names or other tags
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openNewScript("tags")}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  New Script
                </Button>
              </div>

              <div className="space-y-1 max-h-48 overflow-y-auto border rounded-md p-2">
                {scripts.filter((s) => s.type === "tags").length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No tag scripts defined
                  </p>
                ) : (
                  scripts
                    .filter((s) => s.type === "tags")
                    .map((script) => (
                      <div
                        key={script.id}
                        className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50"
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <FileCode className="w-4 h-4 text-muted-foreground shrink-0" />
                          <span className="text-sm truncate">
                            {script.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => openEditScript(script.id)}
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
                            onClick={() => deleteScript(script.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Script Editor */}
      <ScriptEditorDialog
        open={isEditorOpen}
        onOpenChange={setIsEditorOpen}
        scriptId={editingScript?.id}
        scriptType={newScriptType}
      />
    </>
  );
}
