"use client";

import { useAtom, useAtomValue } from "jotai";
import { Check, Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  taggerSessionAtom,
  taggerAvailableColumnsAtom,
} from "@/lib/store/tagger";

const COMMON_TAGS = [
  "TITLE",
  "ARTIST",
  "ALBUM",
  "ALBUMARTIST",
  "TRACKNUMBER",
  "DISCNUMBER",
  "YEAR",
  "GENRE",
  "COMMENT",
  "COMPOSER",
  "CONDUCTOR",
  "LYRICS",
];

export function ColumnSelector() {
  const [session, setSession] = useAtom(taggerSessionAtom);
  const availableColumns = useAtomValue(taggerAvailableColumnsAtom);

  const visibleSet = new Set(session.visibleColumns);

  function toggleColumn(key: string) {
    const newVisible = visibleSet.has(key)
      ? session.visibleColumns.filter((k) => k !== key)
      : [...session.visibleColumns, key];

    setSession({
      ...session,
      visibleColumns: newVisible,
    });
  }

  function showAllPresent() {
    setSession({
      ...session,
      visibleColumns: [
        ...new Set([...session.visibleColumns, ...availableColumns]),
      ],
    });
  }

  function resetToDefault() {
    setSession({
      ...session,
      visibleColumns: [
        "TITLE",
        "ARTIST",
        "ALBUM",
        "ALBUMARTIST",
        "TRACKNUMBER",
        "DISCNUMBER",
        "YEAR",
        "GENRE",
      ],
      columnWidths: {},
      fileColumnWidth: 400,
    });
  }

  // Combine common tags with available tags
  const allTags = [...new Set([...COMMON_TAGS, ...availableColumns])];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 className="w-4 h-4 mr-2" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="end">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Visible Columns</span>
            <Button variant="ghost" size="sm" onClick={resetToDefault}>
              Reset
            </Button>
          </div>

          <div className="space-y-2 max-h-64 overflow-auto">
            {allTags.map((tag) => {
              const isVisible = visibleSet.has(tag);
              const isPresent = availableColumns.includes(tag);

              return (
                <div key={tag} className="flex items-center gap-2">
                  <Checkbox
                    id={`col-${tag}`}
                    checked={isVisible}
                    onCheckedChange={() => toggleColumn(tag)}
                  />
                  <Label
                    htmlFor={`col-${tag}`}
                    className={`text-sm cursor-pointer flex-1 ${!isPresent ? "text-muted-foreground" : ""}`}
                  >
                    {tag.charAt(0) + tag.slice(1).toLowerCase()}
                    {isPresent && (
                      <Check className="w-3 h-3 ml-1 inline-block text-green-500" />
                    )}
                  </Label>
                </div>
              );
            })}
          </div>

          <div className="pt-2 border-t border-border/40">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={showAllPresent}
            >
              Show All Present Tags
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
