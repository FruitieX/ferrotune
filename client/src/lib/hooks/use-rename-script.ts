"use client";

import { useAtomValue, useSetAtom } from "jotai";
import {
  taggerScriptsAtom,
  taggerSessionAtom,
  taggerTracksAtom,
  getTrackTags,
  type TaggerTrackState,
} from "@/lib/store/tagger";

// Characters that are dangerous in filenames across Windows, Linux, macOS
// Windows: \ / : * ? " < > |
// macOS/Linux: / and NUL
// We include all to be safe across platforms
const DANGEROUS_CHARS_REGEX = /[\\/:*?"<>|\x00]/g;

/**
 * Sanitize a path segment based on dangerous char mode settings
 */
function sanitizePathSegment(
  segment: string,
  mode: "ignore" | "strip" | "replace",
  replacement: string,
): string {
  if (mode === "ignore") return segment;
  if (mode === "strip") return segment.replace(DANGEROUS_CHARS_REGEX, "");
  return segment.replace(DANGEROUS_CHARS_REGEX, replacement);
}

/**
 * Process script result which can be either:
 * - An array of path segments (new format)
 * - A string with forward slashes as delimiters (legacy format)
 *
 * Returns a joined path string with dangerous characters sanitized.
 */
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
    // Split and sanitize each segment
    const segments = result.split("/").filter((s) => s.trim());
    const sanitizedSegments = segments.map((seg) =>
      sanitizePathSegment(seg, mode, replacement),
    );
    if (sanitizedSegments.length === 0) return null;
    return sanitizedSegments.join("/");
  }
  return null;
}

/**
 * Hook to run rename scripts on tracks.
 * Provides functions to run the active rename script on specific tracks or all tracks.
 */
export function useRenameScript() {
  const scripts = useAtomValue(taggerScriptsAtom);
  const session = useAtomValue(taggerSessionAtom);
  const setTracks = useSetAtom(taggerTracksAtom);

  function buildContext(
    state: TaggerTrackState | undefined,
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
      filepath: filePath,
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

  /**
   * Run the active rename script on specific track IDs.
   * If no active script, does nothing.
   */
  function runOnTracks(trackIds: string[]) {
    if (!session.activeRenameScriptId) return;

    const script = scripts.find((s) => s.id === session.activeRenameScriptId);
    if (!script) return;

    const dangerousCharMode = session.dangerousCharMode ?? "replace";
    const dangerousCharReplacement = session.dangerousCharReplacement ?? "_";

    setTracks((prev) => {
      const newTracks = new Map(prev);

      for (const id of trackIds) {
        const state = newTracks.get(id);
        if (!state) continue;

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

          newTracks.set(id, {
            ...state,
            computedPath,
          });
        } catch {
          // Keep original path on error
          newTracks.set(id, {
            ...state,
            computedPath: null,
          });
        }
      }

      return newTracks;
    });
  }

  /**
   * Run a rename script on all tracks.
   * If scriptId is provided, uses that script. Otherwise uses the active script from session.
   * If no script is found, does nothing.
   */
  function runOnAllTracks(scriptId?: string) {
    const targetScriptId = scriptId ?? session.activeRenameScriptId;
    if (!targetScriptId) return;

    const script = scripts.find((s) => s.id === targetScriptId);
    if (!script) return;

    const dangerousCharMode = session.dangerousCharMode ?? "replace";
    const dangerousCharReplacement = session.dangerousCharReplacement ?? "_";

    setTracks((prev) => {
      const newTracks = new Map(prev);

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

          newTracks.set(id, {
            ...state,
            computedPath,
          });
        } catch {
          newTracks.set(id, {
            ...state,
            computedPath: null,
          });
        }
      }

      return newTracks;
    });
  }

  /**
   * Check if there's an active rename script
   */
  const hasActiveScript = !!session.activeRenameScriptId;

  return {
    runOnTracks,
    runOnAllTracks,
    hasActiveScript,
  };
}
