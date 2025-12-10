"use client";

// Re-export FindMatchDialog as RefineMatchDialog for backward compatibility
// Both dialogs serve the same purpose - finding a matching track for a missing entry
export { FindMatchDialog as RefineMatchDialog } from "./find-match-dialog";
export type { FindMatchDialogProps as RefineMatchDialogProps } from "./find-match-dialog";
