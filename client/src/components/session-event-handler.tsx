"use client";

import { useAtomValue, useSetAtom } from "jotai";
import {
  useSessionEvents,
  type SessionEvent,
} from "@/lib/hooks/use-session-events";
import { useAudioEngine } from "@/lib/audio/hooks";
import { isAudioOwnerAtom } from "@/lib/store/session";
import { fetchQueueAtom } from "@/lib/store/server-queue";

/**
 * Receives SSE events for the current session and dispatches
 * playback commands to the local audio engine.
 *
 * Only processes commands when this tab is the audio owner
 * (i.e. not remote-controlling another session).
 */
export function SessionEventHandler() {
  const isAudioOwner = useAtomValue(isAudioOwnerAtom);
  const { play, pause, next, previous, seek } = useAudioEngine();
  const fetchQueue = useSetAtom(fetchQueueAtom);

  const handleEvent = (event: SessionEvent) => {
    switch (event.type) {
      case "playbackCommand":
        if (!isAudioOwner) return;
        switch (event.action) {
          case "play":
            play();
            break;
          case "pause":
            pause();
            break;
          case "next":
            next();
            break;
          case "previous":
            previous();
            break;
          case "seek":
            if (event.positionMs !== undefined) {
              seek(event.positionMs / 1000);
            }
            break;
          case "stop":
            pause();
            break;
        }
        break;
      case "queueChanged":
        // Refetch queue state when it changes externally
        fetchQueue();
        break;
      case "sessionEnded":
        // Session was terminated (e.g. by cleanup or another client)
        break;
    }
  };

  useSessionEvents(handleEvent);

  return null;
}
