"use client";

/**
 * Advanced Filter Builder Component
 *
 * A reusable component for building complex search filters similar to
 * smart playlist rules. Supports multiple conditions with and/or logic,
 * various operators per field type, and custom tag filtering.
 */

import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";

// ============================================================================
// Types
// ============================================================================

export interface FilterCondition {
  id: string;
  field: string;
  operator: string;
  value: string | number | boolean;
}

export interface AdvancedFilters {
  logic: "and" | "or";
  conditions: FilterCondition[];
}

export type FieldType = "text" | "number" | "date" | "boolean" | "enum";

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
  { value: "albumartist", label: "Album Artist", type: "text" },
  { value: "composer", label: "Composer", type: "text" },
  { value: "comment", label: "Comment", type: "text" },
  // Boolean filter fields
  { value: "coverArt", label: "Cover Art", type: "boolean" },
  { value: "starred", label: "Starred", type: "boolean" },
  { value: "shuffleExcluded", label: "Shuffle Excluded", type: "boolean" },
  { value: "disabled", label: "Disabled", type: "boolean" },
];

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
          updated.value = fieldType === "boolean" ? true : "";
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

      // Album artist, composer, comment - not yet supported as server-side filters
      case "albumartist":
      case "composer":
      case "comment":
        break;

      // Boolean fields
      case "coverArt":
        // coverArt: "is" + true = has cover art
        // coverArt: "is" + false = missing cover art
        // coverArt: "is not" + true = missing cover art
        // coverArt: "is not" + false = has cover art
        if (
          (operator === "eq" && value === false) ||
          (operator === "neq" && value === true)
        ) {
          params.missingCoverArt = true;
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
