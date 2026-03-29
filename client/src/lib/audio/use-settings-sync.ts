"use client";

/**
 * Settings sync effects: volume, playback settings push, clipping detection.
 *
 * Extracted from useAudioEngineInit — Effects 8, 9, 10.
 */

import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  effectiveVolumeAtom,
  playbackStateAtom,
  transcodingEnabledAtom,
  transcodingBitrateAtom,
  scrobbleThresholdAtom,
  replayGainModeAtom,
  replayGainOffsetAtom,
  clippingDetectionEnabledAtom,
  clippingStateAtom,
} from "@/lib/store/player";
import {
  nativeSetVolume,
  nativeUpdateSettings,
} from "@/lib/audio/native-engine";
import {
  startClippingDetection,
  stopClippingDetection,
} from "@/lib/audio/clipping-detector";
import {
  audioElements,
  activeIndex,
  analyserNode,
} from "@/lib/audio/web-audio";
import { usingNativeAudio } from "@/lib/audio/engine-state";

export function useSettingsSync() {
  const effectiveVolume = useAtomValue(effectiveVolumeAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const transcodingEnabled = useAtomValue(transcodingEnabledAtom);
  const transcodingBitrate = useAtomValue(transcodingBitrateAtom);
  const scrobbleThreshold = useAtomValue(scrobbleThresholdAtom);
  const replayGainMode = useAtomValue(replayGainModeAtom);
  const replayGainOffset = useAtomValue(replayGainOffsetAtom);
  const clippingDetectionEnabled = useAtomValue(clippingDetectionEnabledAtom);
  const setClippingState = useSetAtom(clippingStateAtom);

  // Update volume on both elements
  useEffect(() => {
    if (usingNativeAudio) {
      nativeSetVolume(1.0).catch(console.error);
    } else {
      for (const el of audioElements) {
        if (el) el.volume = effectiveVolume;
      }
    }
  }, [effectiveVolume]);

  // Push playback settings to native service when they change
  useEffect(() => {
    if (!usingNativeAudio) {
      console.log(
        "[NativeAudio] settings sync: skipped (usingNativeAudio=false)",
      );
      return;
    }
    console.log(
      `[NativeAudio] settings sync: mode=${replayGainMode}, offset=${replayGainOffset}, transcoding=${transcodingEnabled}, bitrate=${transcodingBitrate}`,
    );
    nativeUpdateSettings({
      replayGainMode,
      replayGainOffset,
      scrobbleThreshold,
      transcodingEnabled,
      transcodingBitrate,
    })
      .then(() => {
        console.log(
          "[NativeAudio] settings sync: nativeUpdateSettings succeeded",
        );
      })
      .catch((err) => {
        console.error(
          `[NativeAudio] settings sync: nativeUpdateSettings FAILED: ${String(err)}`,
        );
      });
  }, [
    replayGainMode,
    replayGainOffset,
    scrobbleThreshold,
    transcodingEnabled,
    transcodingBitrate,
  ]);

  // Start/stop clipping detection when the setting changes
  useEffect(() => {
    if (!clippingDetectionEnabled) {
      stopClippingDetection();
      setClippingState(null);
    } else if (
      playbackState === "playing" &&
      analyserNode &&
      audioElements[activeIndex]
    ) {
      const audio = audioElements[activeIndex]!;
      startClippingDetection(
        analyserNode,
        setClippingState,
        () => audio.volume,
      );
    }
  }, [clippingDetectionEnabled, setClippingState, playbackState]);
}
