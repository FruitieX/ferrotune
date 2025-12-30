"use client";

import { useState } from "react";
import { ChevronDown, Upload, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface FilesDropdownProps {
  onUpload: () => void;
  onAddFromLibrary: () => void;
  onRemoveSelected: () => void;
  onClearAll: () => void;
  isUploading: boolean;
  hasSelectedTracks: boolean;
  hasAnyTracks: boolean;
}

export function FilesDropdown({
  onUpload,
  onAddFromLibrary,
  onRemoveSelected,
  onClearAll,
  isUploading,
  hasSelectedTracks,
  hasAnyTracks,
}: FilesDropdownProps) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          Files
          <ChevronDown className="w-4 h-4 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            onUpload();
          }}
          disabled={isUploading}
        >
          <Upload className="w-4 h-4" />
          <span>{isUploading ? "Uploading..." : "Upload Files"}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            onAddFromLibrary();
          }}
        >
          <Plus className="w-4 h-4" />
          <span>Add from Library</span>
        </DropdownMenuItem>

        {hasAnyTracks && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setOpen(false);
                onRemoveSelected();
              }}
              disabled={!hasSelectedTracks}
            >
              <Trash2 className="w-4 h-4" />
              <span>Remove Selected from Tagger</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setOpen(false);
                onClearAll();
              }}
              variant="destructive"
            >
              <X className="w-4 h-4" />
              <span>Remove All from Tagger</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
