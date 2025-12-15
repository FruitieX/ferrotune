"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles, Plus, Trash2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getClient } from "@/lib/api/client";
import type { SmartPlaylistInfo } from "@/lib/api/generated/SmartPlaylistInfo";
import type { SmartPlaylistConditionApi } from "@/lib/api/generated/SmartPlaylistConditionApi";

// Field definitions with their supported operators
const FIELDS = [
  { value: "artist", label: "Artist", type: "text" },
  { value: "album", label: "Album", type: "text" },
  { value: "title", label: "Title", type: "text" },
  { value: "genre", label: "Genre", type: "text" },
  { value: "year", label: "Year", type: "number" },
  { value: "playCount", label: "Play Count", type: "number" },
  { value: "duration", label: "Duration (seconds)", type: "number" },
  { value: "dateAdded", label: "Date Added", type: "date" },
  { value: "lastPlayed", label: "Last Played", type: "date" },
  { value: "starred", label: "Starred", type: "boolean" },
] as const;

// Operators by type
const OPERATORS = {
  text: [
    { value: "contains", label: "contains" },
    { value: "eq", label: "equals" },
    { value: "neq", label: "does not equal" },
  ],
  number: [
    { value: "eq", label: "equals" },
    { value: "neq", label: "does not equal" },
    { value: "gt", label: "greater than" },
    { value: "gte", label: "at least" },
    { value: "lt", label: "less than" },
    { value: "lte", label: "at most" },
  ],
  date: [
    { value: "within", label: "within last" },
    { value: "gt", label: "after" },
    { value: "lt", label: "before" },
  ],
  boolean: [{ value: "eq", label: "is" }],
};

// Sort field options
const SORT_FIELDS = [
  { value: "random", label: "Random" },
  { value: "title", label: "Title" },
  { value: "artist", label: "Artist" },
  { value: "album", label: "Album" },
  { value: "year", label: "Year" },
  { value: "playCount", label: "Play Count" },
  { value: "dateAdded", label: "Date Added" },
  { value: "lastPlayed", label: "Last Played" },
  { value: "duration", label: "Duration" },
];

interface Condition {
  id: string;
  field: string;
  operator: string;
  value: string | number | boolean;
}

interface SmartPlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If provided, edit this playlist instead of creating a new one */
  editPlaylist?: SmartPlaylistInfo;
  /** If provided, create the smart playlist in this folder */
  folderPath?: string;
}

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

function parseConditions(conditions: SmartPlaylistConditionApi[]): Condition[] {
  return conditions.map((c) => ({
    id: generateId(),
    field: c.field,
    operator: c.operator,
    value: typeof c.value === "object" ? String(c.value) : c.value,
  }));
}

export function SmartPlaylistDialog({
  open,
  onOpenChange,
  editPlaylist,
  folderPath,
}: SmartPlaylistDialogProps) {
  const queryClient = useQueryClient();
  const isEditing = !!editPlaylist;

  // Form state
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [logic, setLogic] = useState<"and" | "or">("and");
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [sortField, setSortField] = useState("random");
  const [sortDirection, setSortDirection] = useState("asc");
  const [maxSongs, setMaxSongs] = useState("");

  // Track previous open state to reset form
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevEditId, setPrevEditId] = useState(editPlaylist?.id);

  // Reset form when dialog opens or editPlaylist changes
  if (open !== prevOpen || editPlaylist?.id !== prevEditId) {
    setPrevOpen(open);
    setPrevEditId(editPlaylist?.id);
    if (open) {
      if (editPlaylist) {
        setName(editPlaylist.name);
        setComment(editPlaylist.comment ?? "");
        setIsPublic(editPlaylist.isPublic);
        setLogic((editPlaylist.rules.logic as "and" | "or") || "and");
        setConditions(parseConditions(editPlaylist.rules.conditions));
        setSortField(editPlaylist.sortField ?? "random");
        setSortDirection(editPlaylist.sortDirection ?? "asc");
        setMaxSongs(editPlaylist.maxSongs?.toString() ?? "");
      } else {
        // Reset to defaults for new playlist
        setName("");
        setComment("");
        setIsPublic(false);
        setLogic("and");
        setConditions([
          {
            id: generateId(),
            field: "artist",
            operator: "contains",
            value: "",
          },
        ]);
        setSortField("");
        setSortDirection("asc");
        setMaxSongs("");
      }
    }
  }

  // Mutations
  const createMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      const apiConditions = conditions.map((c) => ({
        field: c.field,
        operator: c.operator,
        value: c.value,
      }));

      // Prepend folder path if provided
      const fullName = folderPath ? `${folderPath}/${name}` : name;

      return client.createSmartPlaylist({
        name: fullName,
        comment: comment || null,
        isPublic,
        rules: { conditions: apiConditions, logic },
        sortField: sortField === "random" ? null : sortField,
        sortDirection: sortDirection || null,
        maxSongs: maxSongs ? parseInt(maxSongs, 10) : undefined,
      });
    },
    onSuccess: () => {
      toast.success(`Smart playlist "${name}" created`);
      queryClient.invalidateQueries({ queryKey: ["smartPlaylists"] });
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(`Failed to create smart playlist: ${error.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client || !editPlaylist) throw new Error("Not connected");

      const apiConditions = conditions.map((c) => ({
        field: c.field,
        operator: c.operator,
        value: c.value,
      }));

      return client.updateSmartPlaylist(editPlaylist.id, {
        name,
        comment: comment || null,
        isPublic,
        rules: { conditions: apiConditions, logic },
        sortField: sortField === "random" ? null : sortField,
        sortDirection: sortDirection || null,
        maxSongs: maxSongs ? parseInt(maxSongs, 10) : null,
      });
    },
    onSuccess: () => {
      toast.success(`Smart playlist "${name}" updated`);
      queryClient.invalidateQueries({ queryKey: ["smartPlaylists"] });
      queryClient.invalidateQueries({
        queryKey: ["smartPlaylist", editPlaylist?.id],
      });
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(`Failed to update smart playlist: ${error.message}`);
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  // Handlers
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || conditions.length === 0) return;

    if (isEditing) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const addCondition = () => {
    setConditions([
      ...conditions,
      { id: generateId(), field: "artist", operator: "contains", value: "" },
    ]);
  };

  const removeCondition = (id: string) => {
    if (conditions.length > 1) {
      setConditions(conditions.filter((c) => c.id !== id));
    }
  };

  const updateCondition = (id: string, updates: Partial<Condition>) => {
    setConditions(
      conditions.map((c) => {
        if (c.id !== id) return c;
        const updated = { ...c, ...updates };

        // Reset operator and value when field changes
        if (updates.field && updates.field !== c.field) {
          const fieldDef = FIELDS.find((f) => f.value === updates.field);
          const operators = OPERATORS[fieldDef?.type ?? "text"];
          updated.operator = operators[0].value;
          updated.value = fieldDef?.type === "boolean" ? true : "";
        }

        return updated;
      }),
    );
  };

  const getFieldType = (field: string) => {
    return FIELDS.find((f) => f.value === field)?.type ?? "text";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              {isEditing ? "Edit Smart Playlist" : "Create Smart Playlist"}
            </DialogTitle>
            <DialogDescription>
              Smart playlists automatically include songs matching your rules.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Name */}
            <div className="grid gap-2">
              <Label htmlFor="sp-name">Name</Label>
              <Input
                id="sp-name"
                placeholder="My Smart Playlist"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Description */}
            <div className="grid gap-2">
              <Label htmlFor="sp-comment">Description (optional)</Label>
              <Textarea
                id="sp-comment"
                placeholder="Describe this playlist..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
              />
            </div>

            {/* Public toggle */}
            <div className="flex items-center gap-2">
              <Switch
                id="sp-public"
                checked={isPublic}
                onCheckedChange={setIsPublic}
              />
              <Label htmlFor="sp-public">Public playlist</Label>
            </div>

            {/* Conditions */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>Match</Label>
                <Select
                  value={logic}
                  onValueChange={(v) => setLogic(v as "and" | "or")}
                >
                  <SelectTrigger className="w-20">
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

              <div className="space-y-2 rounded-lg border p-3">
                {conditions.map((cond) => {
                  const fieldType = getFieldType(cond.field);
                  const operators = OPERATORS[fieldType];

                  return (
                    <div key={cond.id} className="flex items-center gap-2">
                      {/* Field selector */}
                      <Select
                        value={cond.field}
                        onValueChange={(v) =>
                          updateCondition(cond.id, { field: v })
                        }
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FIELDS.map((f) => (
                            <SelectItem key={f.value} value={f.value}>
                              {f.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Operator selector */}
                      <Select
                        value={cond.operator}
                        onValueChange={(v) =>
                          updateCondition(cond.id, { operator: v })
                        }
                      >
                        <SelectTrigger className="w-32">
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

                      {/* Value input */}
                      {fieldType === "boolean" ? (
                        <Select
                          value={String(cond.value)}
                          onValueChange={(v) =>
                            updateCondition(cond.id, { value: v === "true" })
                          }
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="true">Yes</SelectItem>
                            <SelectItem value="false">No</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : fieldType === "date" && cond.operator === "within" ? (
                        <Input
                          className="flex-1"
                          placeholder="e.g., 30d, 1w, 6m"
                          value={String(cond.value)}
                          onChange={(e) =>
                            updateCondition(cond.id, { value: e.target.value })
                          }
                        />
                      ) : fieldType === "number" ? (
                        <Input
                          className="flex-1"
                          type="number"
                          placeholder="0"
                          value={String(cond.value)}
                          onChange={(e) =>
                            updateCondition(cond.id, {
                              value: parseInt(e.target.value, 10) || 0,
                            })
                          }
                        />
                      ) : (
                        <Input
                          className="flex-1"
                          placeholder="Value..."
                          value={String(cond.value)}
                          onChange={(e) =>
                            updateCondition(cond.id, { value: e.target.value })
                          }
                        />
                      )}

                      {/* Remove button */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeCondition(cond.id)}
                        disabled={conditions.length <= 1}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  );
                })}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addCondition}
                  className="w-full"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Rule
                </Button>
              </div>
            </div>

            {/* Sorting */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Sort by</Label>
                <Select value={sortField} onValueChange={setSortField}>
                  <SelectTrigger>
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                  <SelectContent>
                    {SORT_FIELDS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Direction</Label>
                <Select value={sortDirection} onValueChange={setSortDirection}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asc">Ascending</SelectItem>
                    <SelectItem value="desc">Descending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Max songs */}
            <div className="grid gap-2">
              <Label htmlFor="sp-max">Max songs (optional)</Label>
              <Input
                id="sp-max"
                type="number"
                placeholder="No limit"
                value={maxSongs}
                onChange={(e) => setMaxSongs(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || conditions.length === 0 || isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {isEditing ? "Saving..." : "Creating..."}
                </>
              ) : isEditing ? (
                "Save Changes"
              ) : (
                "Create"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
