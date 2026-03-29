"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { volumeAtom, isMutedAtom } from "@/lib/store/player";
import {
  serverQueueStateAtom,
  toggleShuffleAtom,
  setRepeatModeAtom,
  type RepeatMode,
} from "@/lib/store/server-queue";
import {
  isRemoteControllingAtom,
  effectiveSessionIdAtom,
} from "@/lib/store/session";
import { getClient } from "@/lib/api/client";

/** Hook for volume control */
export function useVolumeControl() {
  const [volume, setVolume] = useAtom(volumeAtom);
  const [isMuted, setIsMuted] = useAtom(isMutedAtom);
  const effectiveSessionId = useAtomValue(effectiveSessionIdAtom);
  const isRemoteControlling = useAtomValue(isRemoteControllingAtom);

  const sendVolumeCommand = (newVolume: number, newMuted: boolean) => {
    const sessionId = effectiveSessionId;
    if (!sessionId) return;
    const client = getClient();
    if (!client) return;
    // Always send volumeChange for follower sync
    client
      .sendSessionCommand(
        sessionId,
        "volumeChange",
        undefined,
        newVolume,
        newMuted,
      )
      .catch(console.error);
    // When remote-controlling, also send as a playbackCommand so the
    // audio owner applies it (owner ignores volumeChange to prevent echoes)
    if (isRemoteControlling) {
      client
        .sendSessionCommand(
          sessionId,
          "setVolume",
          undefined,
          newVolume,
          newMuted,
        )
        .catch(console.error);
    }
  };

  const toggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    sendVolumeCommand(volume, newMuted);
  };

  const changeVolume = (newVolume: number) => {
    const clamped = Math.max(0, Math.min(1, newVolume));
    setVolume(clamped);
    const newMuted = clamped > 0 ? false : isMuted;
    if (clamped > 0 && isMuted) {
      setIsMuted(false);
    }
    sendVolumeCommand(clamped, newMuted);
  };

  return { volume, isMuted, toggleMute, changeVolume };
}

/** Hook for repeat mode cycling (using server-side state) */
export function useRepeatMode() {
  const queueState = useAtomValue(serverQueueStateAtom);
  const setRepeatModeAction = useSetAtom(setRepeatModeAtom);

  const repeatMode = queueState?.repeatMode ?? "off";

  const cycleRepeatMode = () => {
    const nextMode: Record<RepeatMode, RepeatMode> = {
      off: "all",
      all: "one",
      one: "off",
    };
    setRepeatModeAction(nextMode[repeatMode]);
  };

  return { repeatMode, cycleRepeatMode };
}

/** Hook for shuffle (using server-side state) */
export function useShuffle() {
  const queueState = useAtomValue(serverQueueStateAtom);
  const toggleShuffleAction = useSetAtom(toggleShuffleAtom);

  const isShuffled = queueState?.isShuffled ?? false;

  const toggleShuffle = () => {
    toggleShuffleAction();
  };

  return { isShuffled, toggleShuffle };
}
