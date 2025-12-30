"use client";

import {
  Scissors,
  Copy,
  ClipboardPaste,
  Undo2,
  Redo2,
  Play,
  Trash2,
  FileCode,
  Save,
  Plus,
} from "lucide-react";
import type { TaggerScript } from "@/lib/store/tagger";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";

interface TaggerGridContextMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: { x: number; y: number } | null;
  // Actions
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onRevert: () => void;
  onPlay: () => void;
  onRunScript: (scriptId: string) => void;
  onRunOneOffScript: () => void;
  onSave: () => void;
  onRemove: () => void;
  // State
  canUndo: boolean;
  canRedo: boolean;
  canRevert: boolean;
  canSave: boolean;
  canRemove: boolean;
  scripts: TaggerScript[];
}

export function TaggerGridContextMenu({
  open,
  onOpenChange,
  position,
  onCut,
  onCopy,
  onPaste,
  onUndo,
  onRedo,
  onRevert,
  onPlay,
  onRunScript,
  onRunOneOffScript,
  onSave,
  onRemove,
  canUndo,
  canRedo,
  canRevert,
  canSave,
  canRemove,
  scripts,
}: TaggerGridContextMenuProps) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      {/* Virtual trigger positioned at click coordinates */}
      {position && (
        <div
          style={{
            position: "fixed",
            left: position.x,
            top: position.y,
            width: 0,
            height: 0,
            pointerEvents: "none",
          }}
        >
          {/* Empty trigger - the menu is opened programmatically */}
        </div>
      )}
      <DropdownMenuContent
        className="w-56"
        style={
          position
            ? {
                position: "fixed",
                left: position.x,
                top: position.y,
              }
            : undefined
        }
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuItem onClick={onCut}>
          <Scissors className="w-4 h-4" />
          <span>Cut</span>
          <DropdownMenuShortcut>⌘X</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCopy}>
          <Copy className="w-4 h-4" />
          <span>Copy</span>
          <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onPaste}>
          <ClipboardPaste className="w-4 h-4" />
          <span>Paste</span>
          <DropdownMenuShortcut>⌘V</DropdownMenuShortcut>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={onUndo} disabled={!canUndo}>
          <Undo2 className="w-4 h-4" />
          <span>Undo</span>
          <DropdownMenuShortcut>⌘Z</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onRedo} disabled={!canRedo}>
          <Redo2 className="w-4 h-4" />
          <span>Redo</span>
          <DropdownMenuShortcut>⌘⇧Z</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={onRevert} disabled={!canRevert}>
          <Undo2 className="w-4 h-4" />
          <span>Discard selected changes</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={onPlay}>
          <Play className="w-4 h-4" />
          <span>Play</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FileCode className="w-4 h-4" />
            <span>Run Tag Script</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-64">
            <DropdownMenuItem onClick={onRunOneOffScript}>
              <Plus className="w-4 h-4" />
              <span className="italic">Run One-off Script...</span>
            </DropdownMenuItem>
            {scripts.filter((s) => s.type === "tags").length > 0 && (
              <DropdownMenuSeparator />
            )}
            {scripts
              .filter((s) => s.type === "tags")
              .map((script) => (
                <DropdownMenuItem
                  key={script.id}
                  onClick={() => onRunScript(script.id)}
                >
                  <span className="truncate">{script.name}</span>
                </DropdownMenuItem>
              ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={onSave} disabled={!canSave}>
          <Save className="w-4 h-4" />
          <span>Save Selected</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={onRemove}
          disabled={!canRemove}
          variant="destructive"
        >
          <Trash2 className="w-4 h-4" />
          <span>Remove from Tagger</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
