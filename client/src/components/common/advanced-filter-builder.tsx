"use client";

/**
 * Advanced Filter Builder Component
 *
 * A reusable component for building complex search filters similar to
 * smart playlist rules. Supports multiple conditions with and/or logic,
 * various operators per field type, and custom tag filtering.
 */

import { useState } from "react";
import { Check, ChevronsUpDown, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

export interface FilterCondition {
  id: string;
  field: string;
  operator: string;
  value: string | number | boolean | string[];
}

export interface AdvancedFilters {
  logic: "and" | "or";
  conditions: FilterCondition[];
}

export type FieldType =
  | "text"
  | "number"
  | "date"
  | "boolean"
  | "enum"
  | "multiEnum";

export interface FieldDefinition {
  value: string;
  label: string;
  type: FieldType;
  enumOptions?: { value: string; label: string }[];
}

export interface OperatorDefinition {
  value: string;
  label: string;
}

// ============================================================================
// Default Field Definitions
// ============================================================================

export const DEFAULT_SONG_FIELDS: FieldDefinition[] = [
  { value: "artist", label: "Artist", type: "text" },
  { value: "album", label: "Album", type: "text" },
  { value: "title", label: "Title", type: "text" },
  { value: "genre", label: "Genre", type: "text" },
  { value: "year", label: "Year", type: "number" },
  { value: "playCount", label: "Play Count", type: "number" },
  { value: "duration", label: "Duration (seconds)", type: "number" },
  { value: "bitrate", label: "Bitrate (kbps)", type: "number" },
  { value: "rating", label: "Rating", type: "number" },
  { value: "dateAdded", label: "Date Added", type: "date" },
  { value: "lastPlayed", label: "Last Played", type: "date" },
  {
    value: "fileFormat",
    label: "File Format",
    type: "enum",
    enumOptions: [
      { value: "flac", label: "FLAC" },
      { value: "mp3", label: "MP3" },
      { value: "opus", label: "Opus" },
      { value: "ogg", label: "Ogg Vorbis" },
      { value: "m4a", label: "M4A/AAC" },
      { value: "wav", label: "WAV" },
      { value: "aiff", label: "AIFF" },
    ],
  },
  { value: "starred", label: "Starred", type: "boolean" },
  {
    value: "coverArt",
    label: "Cover Art",
    type: "enum",
    enumOptions: [
      { value: "any", label: "Has Cover Art" },
      { value: "embedded", label: "Has Embedded Cover Art" },
      { value: "album", label: "Has Album Cover Art" },
    ],
  },
  {
    value: "coverArtResolution",
    label: "Cover Art Resolution",
    type: "number",
  },
  { value: "shuffleExcluded", label: "Shuffle Excluded", type: "boolean" },
  { value: "disabled", label: "Disabled", type: "boolean" },
];

/** Fields available for album filtering (matches backend build_album_filter_conditions) */
export const DEFAULT_ALBUM_FIELDS: FieldDefinition[] = [
  { value: "artist", label: "Artist", type: "text" },
  { value: "year", label: "Year", type: "number" },
  { value: "genre", label: "Genre", type: "text" },
  { value: "rating", label: "Rating", type: "number" },
  { value: "starred", label: "Starred", type: "boolean" },
];

/** Fields available for artist filtering (matches backend search_artists filter support) */
export const DEFAULT_ARTIST_FIELDS: FieldDefinition[] = [
  { value: "artist", label: "Name", type: "text" },
  { value: "rating", label: "Rating", type: "number" },
  { value: "starred", label: "Starred", type: "boolean" },
];

/**
 * Build the complete fields list including dynamic library options.
 * Use this when music folder data is available.
 */
export function buildFieldsWithLibraries(
  baseFields: FieldDefinition[],
  musicFolders: { id: number; name: string }[],
): FieldDefinition[] {
  if (musicFolders.length <= 1) return baseFields;
  const libraryField: FieldDefinition = {
    value: "library",
    label: "Library",
    type: "enum",
    enumOptions: musicFolders.map((f) => ({
      value: String(f.id),
      label: f.name,
    })),
  };
  // Insert library after "genre" for discoverability
  const genreIndex = baseFields.findIndex((f) => f.value === "genre");
  const insertAt = genreIndex >= 0 ? genreIndex + 1 : 0;
  return [
    ...baseFields.slice(0, insertAt),
    libraryField,
    ...baseFields.slice(insertAt),
  ];
}

/**
 * Build the complete fields list including dynamic playlist options.
 * Use this when playlist data is available to add an "In Playlist" rule.
 */
export function buildFieldsWithPlaylists(
  baseFields: FieldDefinition[],
  playlists: { id: string; name: string }[],
): FieldDefinition[] {
  if (playlists.length === 0) return baseFields;
  const playlistField: FieldDefinition = {
    value: "inPlaylist",
    label: "In Playlist",
    type: "multiEnum",
    enumOptions: playlists.map((p) => ({
      value: p.id,
      label: p.name,
    })),
  };
  return [...baseFields, playlistField];
}

/**
 * Build the complete fields list including dynamic playlist folder options.
 * Use this when playlist folder data is available to add an "In Playlist Folder" rule.
 */
export function buildFieldsWithPlaylistFolders(
  baseFields: FieldDefinition[],
  folders: { id: string; name: string; path: string }[],
): FieldDefinition[] {
  if (folders.length === 0) return baseFields;
  const folderField: FieldDefinition = {
    value: "inPlaylistFolder",
    label: "In Playlist Folder",
    type: "enum",
    enumOptions: folders.map((f) => ({
      value: f.id,
      label: f.path || f.name,
    })),
  };
  return [...baseFields, folderField];
}

// ============================================================================
// Operators
// ============================================================================

export const OPERATORS: Record<FieldType, OperatorDefinition[]> = {
  text: [
    { value: "contains", label: "contains" },
    { value: "notContains", label: "does not contain" },
    { value: "eq", label: "equals" },
    { value: "neq", label: "does not equal" },
    { value: "startsWith", label: "starts with" },
    { value: "endsWith", label: "ends with" },
    { value: "empty", label: "is empty" },
    { value: "notEmpty", label: "is not empty" },
  ],
  number: [
    { value: "eq", label: "equals" },
    { value: "neq", label: "does not equal" },
    { value: "gt", label: "greater than" },
    { value: "gte", label: "at least" },
    { value: "lt", label: "less than" },
    { value: "lte", label: "at most" },
    { value: "empty", label: "is empty" },
    { value: "notEmpty", label: "is not empty" },
  ],
  date: [
    { value: "within", label: "within last" },
    { value: "gt", label: "after" },
    { value: "lt", label: "before" },
    { value: "empty", label: "never" },
    { value: "notEmpty", label: "has value" },
  ],
  boolean: [
    { value: "eq", label: "is" },
    { value: "neq", label: "is not" },
  ],
  enum: [
    { value: "eq", label: "is" },
    { value: "neq", label: "is not" },
  ],
  multiEnum: [
    { value: "eq", label: "includes any of" },
    { value: "neq", label: "excludes all of" },
  ],
};

// ============================================================================
// Helper Functions
// ============================================================================

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

function getFieldType(field: string, fields: FieldDefinition[]): FieldType {
  return fields.find((f) => f.value === field)?.type ?? "text";
}

function getFieldDefinition(
  field: string,
  fields: FieldDefinition[],
): FieldDefinition | undefined {
  return fields.find((f) => f.value === field);
}

// Check if operator doesn't need a value
function isNoValueOperator(operator: string): boolean {
  return ["empty", "notEmpty"].includes(operator);
}

// ============================================================================
// Component
// ============================================================================

interface AdvancedFilterBuilderProps {
  value: AdvancedFilters;
  onChange: (filters: AdvancedFilters) => void;
  fields?: FieldDefinition[];
  maxHeight?: string;
}

export function AdvancedFilterBuilder({
  value,
  onChange,
  fields = DEFAULT_SONG_FIELDS,
  maxHeight = "300px",
}: AdvancedFilterBuilderProps) {
  // Handlers
  const addCondition = () => {
    const defaultField = fields[0]?.value ?? "artist";
    const newCondition: FilterCondition = {
      id: generateId(),
      field: defaultField,
      operator: OPERATORS[getFieldType(defaultField, fields)][0].value,
      value: "",
    };
    onChange({
      ...value,
      conditions: [...value.conditions, newCondition],
    });
  };

  const removeCondition = (id: string) => {
    onChange({
      ...value,
      conditions: value.conditions.filter((c) => c.id !== id),
    });
  };

  const updateCondition = (id: string, updates: Partial<FilterCondition>) => {
    onChange({
      ...value,
      conditions: value.conditions.map((c) => {
        if (c.id !== id) return c;
        const updated = { ...c, ...updates };

        // Reset operator and value when field changes
        if (updates.field && updates.field !== c.field) {
          const fieldType = getFieldType(updates.field, fields);
          const operators = OPERATORS[fieldType];
          updated.operator = operators[0].value;
          updated.value =
            fieldType === "boolean"
              ? true
              : fieldType === "multiEnum"
                ? []
                : "";
        }

        // Clear value when switching to a no-value operator
        if (updates.operator && isNoValueOperator(updates.operator)) {
          updated.value = "";
        }

        return updated;
      }),
    });
  };

  const setLogic = (logic: "and" | "or") => {
    onChange({ ...value, logic });
  };

  const clearAllFilters = () => {
    onChange({
      logic: "and",
      conditions: [],
    });
  };

  const hasFilters = value.conditions.length > 0;

  return (
    <div className="space-y-4">
      {/* Logic Selector */}
      <div className="flex items-center gap-2">
        <Label className="text-sm">Match</Label>
        <Select
          value={value.logic}
          onValueChange={(v) => setLogic(v as "and" | "or")}
        >
          <SelectTrigger className="w-20 h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="and">all</SelectItem>
            <SelectItem value="or">any</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          of the following rules:
        </span>
      </div>

      {/* Conditions List */}
      <ScrollArea
        className="rounded-lg border border-border/50"
        style={{ maxHeight }}
      >
        <div className="p-3 space-y-2">
          {value.conditions.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No filter rules. Click &quot;Add Rule&quot; to start filtering.
            </p>
          )}

          {value.conditions.map((cond) => (
            <ConditionRow
              key={cond.id}
              condition={cond}
              fields={fields}
              onUpdate={(updates) => updateCondition(cond.id, updates)}
              onRemove={() => removeCondition(cond.id)}
            />
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addCondition}
            className="w-full mt-2"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Rule
          </Button>
        </div>
      </ScrollArea>

      {/* Clear All */}
      {hasFilters && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={clearAllFilters}
          className="text-muted-foreground"
        >
          <X className="w-4 h-4 mr-1" />
          Clear all filters
        </Button>
      )}
    </div>
  );
}

// ============================================================================
// Condition Row Component
// ============================================================================

interface ConditionRowProps {
  condition: FilterCondition;
  fields: FieldDefinition[];
  onUpdate: (updates: Partial<FilterCondition>) => void;
  onRemove: () => void;
}

function ConditionRow({
  condition,
  fields,
  onUpdate,
  onRemove,
}: ConditionRowProps) {
  const fieldDef = getFieldDefinition(condition.field, fields);
  const fieldType = fieldDef?.type ?? "text";
  const operators = OPERATORS[fieldType];
  const showValue = !isNoValueOperator(condition.operator);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Field Selector */}
      <Select
        value={condition.field}
        onValueChange={(v) => onUpdate({ field: v })}
      >
        <SelectTrigger className="w-32 h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fields.map((f) => (
            <SelectItem key={f.value} value={f.value}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Operator Selector */}
      <Select
        value={condition.operator}
        onValueChange={(v) => onUpdate({ operator: v })}
      >
        <SelectTrigger className="w-32 h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((op) => (
            <SelectItem key={op.value} value={op.value}>
              {op.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Value Input */}
      {showValue && (
        <>
          {fieldType === "boolean" ? (
            <Select
              value={String(condition.value)}
              onValueChange={(v) => onUpdate({ value: v === "true" })}
            >
              <SelectTrigger className="w-20 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Yes</SelectItem>
                <SelectItem value="false">No</SelectItem>
              </SelectContent>
            </Select>
          ) : fieldType === "enum" && fieldDef?.enumOptions ? (
            <Select
              value={String(condition.value)}
              onValueChange={(v) => onUpdate({ value: v })}
            >
              <SelectTrigger className="w-28 h-8">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                {fieldDef.enumOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : fieldType === "multiEnum" && fieldDef?.enumOptions ? (
            <MultiEnumSelect
              options={fieldDef.enumOptions}
              value={
                Array.isArray(condition.value)
                  ? condition.value
                  : condition.value
                    ? [String(condition.value)]
                    : []
              }
              onChange={(selected) => onUpdate({ value: selected })}
            />
          ) : fieldType === "date" && condition.operator === "within" ? (
            <Input
              className="w-28 h-8"
              placeholder="e.g., 30d, 1w"
              value={String(condition.value)}
              onChange={(e) => onUpdate({ value: e.target.value })}
            />
          ) : fieldType === "number" ? (
            <Input
              className="w-24 h-8"
              type="number"
              placeholder="0"
              value={String(condition.value)}
              onChange={(e) =>
                onUpdate({ value: parseInt(e.target.value, 10) || 0 })
              }
            />
          ) : fieldType === "date" ? (
            <Input
              className="w-32 h-8"
              type="date"
              value={String(condition.value)}
              onChange={(e) => onUpdate({ value: e.target.value })}
            />
          ) : (
            <Input
              className="flex-1 min-w-[100px] h-8"
              placeholder="Value..."
              value={String(condition.value)}
              onChange={(e) => onUpdate({ value: e.target.value })}
            />
          )}
        </>
      )}

      {/* Remove Button */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={onRemove}
      >
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );
}

// ============================================================================
// Multi-Enum Select Component
// ============================================================================

interface MultiEnumSelectProps {
  options: { value: string; label: string }[];
  value: string[];
  onChange: (value: string[]) => void;
}

function MultiEnumSelect({ options, value, onChange }: MultiEnumSelectProps) {
  const [open, setOpen] = useState(false);

  const toggleOption = (optionValue: string) => {
    if (value.includes(optionValue)) {
      onChange(value.filter((v) => v !== optionValue));
    } else {
      onChange([...value, optionValue]);
    }
  };

  const selectedLabels = value
    .map((v) => options.find((o) => o.value === v)?.label)
    .filter(Boolean);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-8 w-48 justify-between font-normal"
        >
          <span className="truncate">
            {selectedLabels.length === 0
              ? "Select..."
              : selectedLabels.length === 1
                ? selectedLabels[0]
                : `${selectedLabels.length} selected`}
          </span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search..." />
          <CommandList>
            <CommandEmpty>No options found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  onSelect={() => toggleOption(option.value)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value.includes(option.value)
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {value.length > 0 && (
          <div className="border-t p-2 flex flex-wrap gap-1">
            {value.map((v) => {
              const label = options.find((o) => o.value === v)?.label ?? v;
              return (
                <Badge
                  key={v}
                  variant="secondary"
                  className="text-xs cursor-pointer"
                  onClick={() => toggleOption(v)}
                >
                  {label}
                  <X className="ml-1 h-3 w-3" />
                </Badge>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ============================================================================
// Utility: Convert AdvancedFilters to API SearchParams
// ============================================================================

/**
/**
 * Parse a relative duration string (e.g., "30d", "2w", "6m") to an ISO 8601 date string.
 */
function parseDurationToDate(duration: string): string {
  const match = duration.match(/^(\d+)\s*([dwmy])$/i);
  if (!match) return duration; // Return as-is if not a valid duration

  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const date = new Date();

  switch (unit) {
    case "d":
      date.setDate(date.getDate() - amount);
      break;
    case "w":
      date.setDate(date.getDate() - amount * 7);
      break;
    case "m":
      date.setMonth(date.getMonth() - amount);
      break;
    case "y":
      date.setFullYear(date.getFullYear() - amount);
      break;
  }

  return date.toISOString().split("T")[0]; // Return YYYY-MM-DD
}

/**
 * Convert AdvancedFilters to a flat object suitable for API query params.
 * This handles the conversion from our rule-based format to the backend's
 * flat filter format.
 */
export function filtersToSearchParams(
  filters: AdvancedFilters,
): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {};

  // Convert conditions to flat params
  // For simple cases, we can map directly to SearchParams fields
  // For complex cases (OR logic, multiple conditions on same field),
  // we may need to handle separately
  for (const cond of filters.conditions) {
    const { field, operator, value } = cond;

    // Handle range operators
    switch (field) {
      case "year":
        if (operator === "gte" || operator === "eq") {
          params.minYear = Number(value);
          if (operator === "eq") params.maxYear = Number(value);
        } else if (operator === "lte") {
          params.maxYear = Number(value);
        } else if (operator === "gt") {
          params.minYear = Number(value) + 1;
        } else if (operator === "lt") {
          params.maxYear = Number(value) - 1;
        }
        break;

      case "duration":
        if (operator === "gte" || operator === "eq") {
          params.minDuration = Number(value);
          if (operator === "eq") params.maxDuration = Number(value);
        } else if (operator === "lte") {
          params.maxDuration = Number(value);
        } else if (operator === "gt") {
          params.minDuration = Number(value) + 1;
        } else if (operator === "lt") {
          params.maxDuration = Number(value) - 1;
        }
        break;

      case "playCount":
        if (operator === "gte" || operator === "eq") {
          params.minPlayCount = Number(value);
          if (operator === "eq") params.maxPlayCount = Number(value);
        } else if (operator === "lte") {
          params.maxPlayCount = Number(value);
        } else if (operator === "gt") {
          params.minPlayCount = Number(value) + 1;
        } else if (operator === "lt") {
          params.maxPlayCount = Number(value) - 1;
        }
        break;

      case "bitrate":
        if (operator === "gte" || operator === "eq") {
          params.minBitrate = Number(value);
        } else if (operator === "lte") {
          params.maxBitrate = Number(value);
        } else if (operator === "gt") {
          params.minBitrate = Number(value) + 1;
        } else if (operator === "lt") {
          params.maxBitrate = Number(value) - 1;
        }
        break;

      case "genre":
        if (operator === "eq" || operator === "contains") {
          params.genre = String(value);
        }
        break;

      case "fileFormat":
        if (operator === "eq") {
          params.fileFormat = String(value);
        }
        break;

      case "dateAdded":
        if (operator === "within") {
          params.addedAfter = parseDurationToDate(String(value));
        } else if (operator === "gt") {
          params.addedAfter = String(value);
        } else if (operator === "lt") {
          params.addedBefore = String(value);
        }
        break;

      case "lastPlayed":
        if (operator === "within") {
          params.lastPlayedAfter = parseDurationToDate(String(value));
        } else if (operator === "gt") {
          params.lastPlayedAfter = String(value);
        } else if (operator === "lt") {
          params.lastPlayedBefore = String(value);
        }
        break;

      // Text fields - use server-side substring filters
      case "artist":
        if (operator === "contains" || operator === "eq") {
          params.artistFilter = String(value);
        }
        break;
      case "album":
        if (operator === "contains" || operator === "eq") {
          params.albumFilter = String(value);
        }
        break;
      case "title":
        if (operator === "contains" || operator === "eq") {
          params.titleFilter = String(value);
        }
        break;

      // Cover art enum field
      case "coverArt":
        // The flat search API only supports "missing cover art" boolean
        // coverArt: "is" + "any" = has any cover art (not directly supported in flat API)
        // coverArt: "is not" + "any" = missing cover art
        if (operator === "neq" && value === "any") {
          params.missingCoverArt = true;
        }
        break;

      // Cover art resolution - not supported in flat search API
      case "coverArtResolution":
        break;

      // Library/music folder
      case "library":
        if (operator === "eq" && value) {
          params.musicFolderId = Number(value);
        }
        break;

      case "starred":
        // starred: "is" + true = starred only
        // starred: "is not" + true = not starred
        if (operator === "eq" && value === true) {
          params.starredOnly = true;
        }
        break;

      case "shuffleExcluded":
        // shuffleExcluded: "is" + true = shuffle excluded only
        if (operator === "eq" && value === true) {
          params.shuffleExcludedOnly = true;
        }
        break;

      case "disabled":
        // disabled: "is" + true = disabled only
        if (operator === "eq" && value === true) {
          params.disabledOnly = true;
        }
        break;

      case "rating":
        if (operator === "gte" || operator === "eq") {
          params.minRating = Number(value);
          if (operator === "eq") params.maxRating = Number(value);
        } else if (operator === "lte") {
          params.maxRating = Number(value);
        } else if (operator === "gt") {
          params.minRating = Number(value) + 1;
        } else if (operator === "lt") {
          params.maxRating = Number(value) - 1;
        }
        break;
    }
  }

  return params;
}

// ============================================================================
// Export defaults
// ============================================================================

export const EMPTY_FILTERS: AdvancedFilters = {
  logic: "and",
  conditions: [],
};

/** Creates a default empty filter condition using the first available field */
export function createDefaultCondition(
  fields: FieldDefinition[] = DEFAULT_SONG_FIELDS,
): FilterCondition {
  const defaultField = fields[0]?.value ?? "artist";
  const fieldType =
    fields.find((f) => f.value === defaultField)?.type ?? "text";
  return {
    id: generateId(),
    field: defaultField,
    operator: OPERATORS[fieldType][0].value,
    value: "",
  };
}
