"use client";

import { useEffect, useRef } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { getClient } from "@/lib/api/client";
import { useAudioEngine } from "@/lib/audio/hooks";
import { isClientInitializedAtom } from "@/lib/store/auth";
import {
  clientIdAtom,
  connectedClientsAtom,
  effectiveSessionIdAtom,
  isAudioOwnerAtom,
  ownerClientIdAtom,
  ownerClientNameAtom,
  remotePlaybackStateAtom,
  selfTakeoverPending,
} from "@/lib/store/session";
import {
  fetchQueueAndPlayAtom,
  fetchQueueAndRestoreAtom,
} from "@/lib/store/server-queue";
import { appResumeRepaintEvent } from "@/lib/utils/app-resume-repaint";

export interface SessionOwnerSnapshot {
  ownerClientId?: string | null;
  ownerClientName?: string | null;
  resumePlayback?: boolean;
}

function isVisible(): boolean {
  return (
    typeof document === "undefined" || document.visibilityState === "visible"
  );
}

/**
 * Applies authoritative session ownership snapshots from SSE or foreground
 * recovery. This keeps the exact same handover semantics in one place:
 * repeated self-owner snapshots are idempotent, only explicit resume intents
 * auto-play, and losing ownership pauses local audio before becoming a
 * follower.
 */
export function useSessionOwnerState() {
  const isAudioOwner = useAtomValue(isAudioOwnerAtom);
  const [, setIsAudioOwner] = useAtom(isAudioOwnerAtom);
  const ownerClientId = useAtomValue(ownerClientIdAtom);
  const clientId = useAtomValue(clientIdAtom);
  const setRemotePlaybackState = useSetAtom(remotePlaybackStateAtom);
  const setOwnerClientId = useSetAtom(ownerClientIdAtom);
  const setOwnerClientName = useSetAtom(ownerClientNameAtom);
  const fetchQueueAndRestore = useSetAtom(fetchQueueAndRestoreAtom);
  const fetchQueueAndPlay = useSetAtom(fetchQueueAndPlayAtom);
  const { pause } = useAudioEngine();

  const applyOwnerSnapshot = (snapshot: SessionOwnerSnapshot) => {
    const nextOwnerClientId = snapshot.ownerClientId ?? null;
    const isCurrentClientOwner =
      clientId !== "" && nextOwnerClientId === clientId;
    const isSameOwnerAnnouncement =
      isCurrentClientOwner &&
      (isAudioOwner || ownerClientId === clientId || selfTakeoverPending.value);

    setOwnerClientId(nextOwnerClientId);
    setOwnerClientName(
      nextOwnerClientId ? (snapshot.ownerClientName ?? null) : null,
    );

    if (nextOwnerClientId) {
      if (isCurrentClientOwner) {
        // SSE sends an initial ownership snapshot on every reconnect. If it
        // says we are still the owner, avoid reloading the active audio element.
        if (isSameOwnerAnnouncement) {
          setIsAudioOwner(true);
          setRemotePlaybackState(null);
          return;
        }

        // We became the owner. Do not clear selfTakeoverPending here; the
        // PlaybackCommand { takeOver } echo handler consumes it.
        setIsAudioOwner(true);
        setRemotePlaybackState(null);

        if (snapshot.resumePlayback === true) {
          fetchQueueAndPlay();
        } else {
          fetchQueueAndRestore();
        }
        return;
      }

      if (isAudioOwner) {
        pause();
        setIsAudioOwner(false);
      }
      return;
    }

    // Ownership was cleared by the server. Restore locally in a paused,
    // controllable state without implicit playback so this tab can claim
    // ownership on the next play action instead of routing commands to a
    // stale/disconnected owner.
    if (isAudioOwner) {
      pause();
    }
    setIsAudioOwner(true);
    setRemotePlaybackState(null);
    fetchQueueAndRestore();
  };

  return { applyOwnerSnapshot };
}

/**
 * Read-only foreground recovery for tabs whose SSE stream was closed while
 * hidden. This refreshes ownership/client list without calling connectSession(),
 * because connectSession() may intentionally mutate ownership for stale owners.
 */
export function useSessionOwnershipRecovery() {
  const isClientInitialized = useAtomValue(isClientInitializedAtom);
  const sessionId = useAtomValue(effectiveSessionIdAtom);
  const setConnectedClients = useSetAtom(connectedClientsAtom);
  const { applyOwnerSnapshot } = useSessionOwnerState();
  const applyOwnerSnapshotRef = useRef(applyOwnerSnapshot);
  const recoveringRef = useRef(false);

  useEffect(() => {
    applyOwnerSnapshotRef.current = applyOwnerSnapshot;
  });

  useEffect(() => {
    if (!isClientInitialized || !sessionId) return;

    const recover = async () => {
      if (recoveringRef.current) return;
      const client = getClient();
      if (!client) return;

      recoveringRef.current = true;
      let session: Awaited<ReturnType<typeof client.getSessionInfo>>;
      let clients: Awaited<ReturnType<typeof client.listClients>>;
      try {
        [session, clients] = await Promise.all([
          client.getSessionInfo(),
          client.listClients(),
        ]);
      } catch {
        // SSE reconnection will retry implicitly; keep foreground recovery silent.
        recoveringRef.current = false;
        return;
      }

      applyOwnerSnapshotRef.current({
        ownerClientId: session.ownerClientId,
        ownerClientName: session.ownerClientId ? session.ownerClientName : null,
      });
      setConnectedClients(clients.clients);
      recoveringRef.current = false;
    };

    const recoverIfVisible = () => {
      if (isVisible()) {
        recover();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", recoverIfVisible);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", recoverIfVisible);
      window.addEventListener("pageshow", recoverIfVisible);
      window.addEventListener(appResumeRepaintEvent, recoverIfVisible);
    }

    return () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", recoverIfVisible);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", recoverIfVisible);
        window.removeEventListener("pageshow", recoverIfVisible);
        window.removeEventListener(appResumeRepaintEvent, recoverIfVisible);
      }
    };
  }, [isClientInitialized, sessionId, setConnectedClients]);
}
