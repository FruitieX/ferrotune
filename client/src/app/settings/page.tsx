"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useTheme } from "next-themes";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  Settings as SettingsIcon,
  Server,
  Volume2,
  Repeat,
  Shuffle,
  Palette,
  Check,
  ExternalLink,
  Music2,
  HardDrive,
  User,
  Sun,
  Moon,
  Monitor,
  BarChart3,
  Disc,
  Users,
  ListMusic,
  Clock,
  PlayCircle,
  Activity,
  Shield,
  Tag,
  Rows3,
} from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useAccentColor } from "@/lib/hooks/use-preferences-sync";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { serverConnectionAtom } from "@/lib/store/auth";
import {
  volumeAtom,
  repeatModeAtom,
  replayGainModeAtom,
  replayGainOffsetAtom,
  transcodingEnabledAtom,
  transcodingBitrateAtom,
  transcodingSeekModeAtom,
  clippingDetectionEnabledAtom,
  type ReplayGainMode,
  type SeekMode,
} from "@/lib/store/player";
import {
  serverQueueStateAtom,
  toggleShuffleAtom,
} from "@/lib/store/server-queue";
import { getClient } from "@/lib/api/client";
import {
  ACCENT_PRESETS,
  type AccentColor,
  progressBarStyleAtom,
  sidebarItemSizeAtom,
  type SidebarItemSize,
} from "@/lib/store/ui";
import { useEffect, useState } from "react";
import {
  parseCssColorToOklch,
  clampOklchToSliderRanges,
} from "@/lib/utils/color";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTotalDuration, formatFileSize } from "@/lib/utils/format";

export default function SettingsPage() {
  const { isReady, isLoading: authLoading } = useAuth({
    redirectToLogin: true,
  });
  const isMounted = useIsMounted();
  const { isAdmin } = useCurrentUser();
  const [connection] = useAtom(serverConnectionAtom);
  const [volume, setVolume] = useAtom(volumeAtom);
  const [progressBarStyle, setProgressBarStyle] = useAtom(progressBarStyleAtom);
  const [sidebarItemSize, setSidebarItemSize] = useAtom(sidebarItemSizeAtom);
  const [repeatMode, setRepeatMode] = useAtom(repeatModeAtom);
  const [replayGainMode, setReplayGainMode] = useAtom(replayGainModeAtom);
  const [replayGainOffset, setReplayGainOffset] = useAtom(replayGainOffsetAtom);
  const [clippingDetectionEnabled, setClippingDetectionEnabled] = useAtom(
    clippingDetectionEnabledAtom,
  );
  const [transcodingEnabled, setTranscodingEnabled] = useAtom(
    transcodingEnabledAtom,
  );
  const [transcodingBitrate, setTranscodingBitrate] = useAtom(
    transcodingBitrateAtom,
  );
  const [transcodingSeekMode, setTranscodingSeekMode] = useAtom(
    transcodingSeekModeAtom,
  );
  const queueState = useAtomValue(serverQueueStateAtom);
  const toggleShuffle = useSetAtom(toggleShuffleAtom);
  const { theme, setTheme } = useTheme();

  // Derive shuffle state from server queue state
  const isShuffled = queueState?.isShuffled ?? false;

  // Fetch server stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["serverStats"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getStats();
    },
    enabled: isReady,
    staleTime: 60000, // Cache for 1 minute
  });

  // Use the centralized accent color hook that syncs with server
  const {
    accentColor,
    customHue,
    customLightness,
    customChroma,
    setAccentColor,
    setCustomHue,
    setCustomLightness,
    setCustomChroma,
  } = useAccentColor();

  // Local state for OKLCH input to prevent cursor jumping while typing
  const [oklchInputValue, setOklchInputValue] = useState("");
  const [oklchInputFocused, setOklchInputFocused] = useState(false);

  // Compute display values: use preset values when a preset is active, custom values otherwise
  // This ensures sliders always show correct values even before the sync effect runs
  // Provide defaults to handle hydration edge cases
  const displayValues =
    accentColor === "custom"
      ? {
          hue: customHue ?? 45,
          lightness: customLightness ?? 0.65,
          chroma: customChroma ?? 0.18,
        }
      : (() => {
          const preset = ACCENT_PRESETS.find((p) => p.name === accentColor);
          return preset
            ? { hue: preset.hue, lightness: 0.65, chroma: 0.18 }
            : {
                hue: customHue ?? 45,
                lightness: customLightness ?? 0.65,
                chroma: customChroma ?? 0.18,
              };
        })();

  // Sync custom atom values to preset values when a preset is active
  // This keeps the atoms in sync for when user switches to custom mode
  useEffect(() => {
    if (accentColor !== "custom") {
      const preset = ACCENT_PRESETS.find((p) => p.name === accentColor);
      if (preset) {
        // Update local state only, don't trigger server sync
        setCustomHue(preset.hue);
        setCustomLightness(0.65);
        setCustomChroma(0.18);
      }
    }
  }, [accentColor, setCustomHue, setCustomLightness, setCustomChroma]);

  const handleAccentColorChange = (color: AccentColor) => {
    setAccentColor(color);
  };

  const handleCustomHueChange = (hue: number) => {
    setCustomHue(hue);
  };

  const handleCustomLightnessChange = (lightness: number) => {
    setCustomLightness(lightness);
  };

  const handleCustomChromaChange = (chroma: number) => {
    setCustomChroma(chroma);
  };

  // Always render the same loading state on server and during hydration
  // This prevents hydration mismatches
  if (!isMounted || authLoading) {
    return (
      <div className="p-4 lg:p-6 space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      {/* Header */}
      <div className="px-4 lg:px-6 pt-8 pb-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3"
        >
          <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
            <SettingsIcon className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Manage your preferences
            </p>
          </div>
        </motion.div>
      </div>

      <div className="px-4 lg:px-6 pb-24 space-y-6">
        {/* Server Connection */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="w-5 h-5" />
                Server Connection
              </CardTitle>
              <CardDescription>
                Your Ferrotune server connection details
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                  <Check className="w-5 h-5 text-green-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">Connected</p>
                  <p className="text-sm text-muted-foreground truncate">
                    {connection?.serverUrl}
                  </p>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={connection?.serverUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <User className="w-4 h-4" />
                    <span className="text-xs uppercase tracking-wider">
                      Username
                    </span>
                  </div>
                  <p className="font-medium">{connection?.username}</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <HardDrive className="w-4 h-4" />
                    <span className="text-xs uppercase tracking-wider">
                      Auth Type
                    </span>
                  </div>
                  <p className="font-medium">
                    {connection?.apiKey ? "API Key" : "Password"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Administration (admin only) */}
        {isAdmin && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
          >
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    Server Administration
                  </CardTitle>
                  <CardDescription>
                    Manage users, libraries, and server settings
                  </CardDescription>
                </div>
                <Link href="/admin">
                  <Button
                    size="sm"
                    className="gap-2 bg-primary hover:bg-primary/80"
                  >
                    <Shield className="w-4 h-4" />
                    Administration
                  </Button>
                </Link>
              </CardHeader>
            </Card>
          </motion.div>
        )}

        {/* Library Statistics */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5" />
                  Library Statistics
                </CardTitle>
                <CardDescription>
                  Overview of your music library
                </CardDescription>
              </div>
              <Link href="/tagger">
                <Button size="sm" variant="outline" className="gap-2">
                  <Tag className="w-4 h-4" />
                  Tag Editor
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="p-3 rounded-lg bg-muted/30">
                      <Skeleton className="h-4 w-16 mb-2" />
                      <Skeleton className="h-6 w-12" />
                    </div>
                  ))}
                </div>
              ) : stats ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Music2 className="w-4 h-4" />
                      <span className="text-xs uppercase tracking-wider">
                        Songs
                      </span>
                    </div>
                    <p className="text-xl font-bold">
                      {stats.songCount.toLocaleString()}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Disc className="w-4 h-4" />
                      <span className="text-xs uppercase tracking-wider">
                        Albums
                      </span>
                    </div>
                    <p className="text-xl font-bold">
                      {stats.albumCount.toLocaleString()}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Users className="w-4 h-4" />
                      <span className="text-xs uppercase tracking-wider">
                        Artists
                      </span>
                    </div>
                    <p className="text-xl font-bold">
                      {stats.artistCount.toLocaleString()}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <ListMusic className="w-4 h-4" />
                      <span className="text-xs uppercase tracking-wider">
                        Playlists
                      </span>
                    </div>
                    <p className="text-xl font-bold">
                      {stats.playlistCount.toLocaleString()}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Clock className="w-4 h-4" />
                      <span className="text-xs uppercase tracking-wider">
                        Total Duration
                      </span>
                    </div>
                    <p className="text-xl font-bold">
                      {formatTotalDuration(stats.totalDurationSeconds)}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <HardDrive className="w-4 h-4" />
                      <span className="text-xs uppercase tracking-wider">
                        Library Size
                      </span>
                    </div>
                    <p className="text-xl font-bold">
                      {formatFileSize(stats.totalSizeBytes)}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <PlayCircle className="w-4 h-4" />
                      <span className="text-xs uppercase tracking-wider">
                        Total Plays
                      </span>
                    </div>
                    <p className="text-xl font-bold">
                      {stats.totalPlays.toLocaleString()}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Music2 className="w-4 h-4" />
                      <span className="text-xs uppercase tracking-wider">
                        Genres
                      </span>
                    </div>
                    <p className="text-xl font-bold">
                      {stats.genreCount.toLocaleString()}
                    </p>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </motion.div>

        {/* Playback Settings */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.17 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Music2 className="w-5 h-5" />
                Playback
              </CardTitle>
              <CardDescription>Audio playback preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Volume */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 font-medium">
                    <Volume2 className="w-4 h-4" />
                    Default Volume
                  </label>
                  <span className="text-sm text-muted-foreground">
                    {Math.round(volume * 100)}%
                  </span>
                </div>
                <Slider
                  value={[volume]}
                  onValueChange={([v]) => setVolume(v)}
                  min={0}
                  max={1}
                  step={0.01}
                  className="w-full"
                />
              </div>

              <Separator />

              {/* Repeat Mode */}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 font-medium">
                  <Repeat className="w-4 h-4" />
                  Repeat Mode
                </label>
                <Select
                  value={repeatMode}
                  onValueChange={(v: string) =>
                    setRepeatMode(v as typeof repeatMode)
                  }
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">Off</SelectItem>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="one">One</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              {/* Shuffle */}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 font-medium">
                  <Shuffle className="w-4 h-4" />
                  Shuffle by Default
                </label>
                <Switch
                  checked={isShuffled}
                  onCheckedChange={() => toggleShuffle()}
                />
              </div>

              <Separator />

              {/* Transcoding */}
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <label className="flex items-center gap-2 font-medium">
                    <Activity className="w-4 h-4" />
                    Audio Transcoding
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Convert to Opus for lower bandwidth and embedded ReplayGain
                  </p>
                </div>
                <Switch
                  checked={transcodingEnabled}
                  onCheckedChange={setTranscodingEnabled}
                />
              </div>

              {/* Transcoding Bitrate - only show when transcoding is enabled */}
              {transcodingEnabled && (
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 font-medium">
                    <Volume2 className="w-4 h-4" />
                    Transcode Bitrate
                  </label>
                  <Select
                    value={String(transcodingBitrate)}
                    onValueChange={(v) => setTranscodingBitrate(Number(v))}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="64">64 kbps</SelectItem>
                      <SelectItem value="96">96 kbps</SelectItem>
                      <SelectItem value="128">128 kbps</SelectItem>
                      <SelectItem value="160">160 kbps</SelectItem>
                      <SelectItem value="192">192 kbps</SelectItem>
                      <SelectItem value="256">256 kbps</SelectItem>
                      <SelectItem value="320">320 kbps</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Seek Mode - only show when transcoding is enabled */}
              {transcodingEnabled && (
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <label className="flex items-center gap-2 font-medium">
                      <Clock className="w-4 h-4" />
                      Seek Mode
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Accurate is slower but precise; Coarse is faster
                    </p>
                  </div>
                  <Select
                    value={transcodingSeekMode}
                    onValueChange={(v: string) =>
                      setTranscodingSeekMode(v as SeekMode)
                    }
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="coarse">Coarse</SelectItem>
                      <SelectItem value="accurate">Accurate</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <Separator />

              {/* ReplayGain Mode */}
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <label className="flex items-center gap-2 font-medium">
                    <Activity className="w-4 h-4" />
                    ReplayGain
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Normalize volume across tracks
                  </p>
                </div>
                <Select
                  value={replayGainMode}
                  onValueChange={(v: string) =>
                    setReplayGainMode(v as ReplayGainMode)
                  }
                >
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="computed">Computed</SelectItem>
                    <SelectItem value="original">Original Tags</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* ReplayGain Offset - only show when ReplayGain is enabled */}
              {replayGainMode !== "disabled" && (
                <>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 font-medium">
                        <Volume2 className="w-4 h-4" />
                        ReplayGain Offset
                      </label>
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {replayGainOffset >= 0 ? "+" : ""}
                        {replayGainOffset.toFixed(1)} dB
                      </span>
                    </div>
                    <Slider
                      value={[replayGainOffset]}
                      onValueChange={([v]) => setReplayGainOffset(v)}
                      min={-12}
                      max={12}
                      step={0.5}
                      className="w-full"
                    />
                    <p className="text-xs text-muted-foreground">
                      Adjust all tracks up or down from their computed gain
                    </p>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <label className="font-medium">Clipping Detection</label>
                      <p className="text-xs text-muted-foreground">
                        Show a warning when audio would clip at full volume
                      </p>
                    </div>
                    <Switch
                      checked={clippingDetectionEnabled}
                      onCheckedChange={setClippingDetectionEnabled}
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Appearance */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="w-5 h-5" />
                Appearance
              </CardTitle>
              <CardDescription>Customize the look and feel</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <label className="font-medium">Theme</label>
                <div className="flex gap-2">
                  <Button
                    variant={theme === "light" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTheme("light")}
                    className="gap-1.5"
                  >
                    <Sun className="w-4 h-4" />
                    Light
                  </Button>
                  <Button
                    variant={theme === "dark" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTheme("dark")}
                    className="gap-1.5"
                  >
                    <Moon className="w-4 h-4" />
                    Dark
                  </Button>
                  <Button
                    variant={theme === "system" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTheme("system")}
                    className="gap-1.5"
                  >
                    <Monitor className="w-4 h-4" />
                    System
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Accent Color */}
              <div className="space-y-3">
                <div className="text-sm font-medium">Accent Color</div>
                <div className="flex flex-wrap gap-2">
                  {ACCENT_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      onClick={() => handleAccentColorChange(preset.name)}
                      className={`w-10 h-10 rounded-full transition-all hover:scale-110 ${
                        accentColor === preset.name
                          ? "ring-2 ring-offset-2 ring-offset-background ring-foreground"
                          : ""
                      }`}
                      style={{
                        backgroundColor: `oklch(0.65 0.18 ${preset.hue})`,
                      }}
                      title={preset.label}
                    />
                  ))}
                </div>

                <Separator />

                {/* Custom Color */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Custom Color</Label>
                    <Button
                      variant={accentColor === "custom" ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleAccentColorChange("custom")}
                    >
                      {accentColor === "custom" ? "Active" : "Use Custom"}
                    </Button>
                  </div>

                  <div className="space-y-4">
                    {/* Color preview swatch */}
                    <div className="flex items-center gap-3">
                      <div
                        className="w-12 h-12 rounded-full shrink-0 border border-border"
                        style={{
                          backgroundColor: `oklch(${displayValues.lightness} ${displayValues.chroma} ${displayValues.hue})`,
                        }}
                      />
                      <input
                        type="text"
                        value={
                          oklchInputFocused
                            ? oklchInputValue
                            : `oklch(${displayValues.lightness.toFixed(2)} ${displayValues.chroma.toFixed(2)} ${Math.round(displayValues.hue)})`
                        }
                        placeholder="#ff5500, rgb(255,85,0), hsl(20,100%,50%)"
                        onFocus={(e) => {
                          setOklchInputFocused(true);
                          setOklchInputValue(e.target.value);
                        }}
                        onChange={(e) => {
                          setOklchInputValue(e.target.value);
                        }}
                        onBlur={(e) => {
                          setOklchInputFocused(false);
                          const parsed = parseCssColorToOklch(
                            e.target.value.trim(),
                          );
                          if (parsed) {
                            const clamped = clampOklchToSliderRanges(parsed);
                            handleCustomLightnessChange(clamped.l);
                            handleCustomChromaChange(clamped.c);
                            handleCustomHueChange(clamped.h);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur();
                          }
                        }}
                        className="flex-1 px-3 py-1.5 text-sm font-mono bg-muted border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>

                    {/* Hue slider */}
                    <div className="flex items-center gap-4">
                      <div className="w-16 shrink-0">
                        <span className="text-xs text-muted-foreground">
                          Hue
                        </span>
                      </div>
                      <Slider
                        value={[displayValues.hue]}
                        onValueChange={([v]) => handleCustomHueChange(v)}
                        min={0}
                        max={360}
                        step={1}
                        className="flex-1"
                        style={{
                          background: `linear-gradient(to right, 
                            oklch(${displayValues.lightness} ${displayValues.chroma} 0),
                            oklch(${displayValues.lightness} ${displayValues.chroma} 60),
                            oklch(${displayValues.lightness} ${displayValues.chroma} 120),
                            oklch(${displayValues.lightness} ${displayValues.chroma} 180),
                            oklch(${displayValues.lightness} ${displayValues.chroma} 240),
                            oklch(${displayValues.lightness} ${displayValues.chroma} 300),
                            oklch(${displayValues.lightness} ${displayValues.chroma} 360)
                          )`,
                          borderRadius: "9999px",
                        }}
                      />
                      <span className="text-xs text-muted-foreground w-10 text-right">
                        {Math.round(displayValues.hue)}°
                      </span>
                    </div>

                    {/* Lightness slider */}
                    <div className="flex items-center gap-4">
                      <div className="w-16 shrink-0">
                        <span className="text-xs text-muted-foreground">
                          Lightness
                        </span>
                      </div>
                      <Slider
                        value={[displayValues.lightness]}
                        onValueChange={([v]) => handleCustomLightnessChange(v)}
                        min={0.3}
                        max={0.9}
                        step={0.01}
                        className="flex-1"
                        style={{
                          background: `linear-gradient(to right, 
                            oklch(0.3 ${displayValues.chroma} ${displayValues.hue}),
                            oklch(0.6 ${displayValues.chroma} ${displayValues.hue}),
                            oklch(0.9 ${displayValues.chroma} ${displayValues.hue})
                          )`,
                          borderRadius: "9999px",
                        }}
                      />
                      <span className="text-xs text-muted-foreground w-10 text-right">
                        {Math.round(displayValues.lightness * 100)}%
                      </span>
                    </div>

                    {/* Chroma slider */}
                    <div className="flex items-center gap-4">
                      <div className="w-16 shrink-0">
                        <span className="text-xs text-muted-foreground">
                          Saturation
                        </span>
                      </div>
                      <Slider
                        value={[displayValues.chroma]}
                        onValueChange={([v]) => handleCustomChromaChange(v)}
                        min={0.01}
                        max={0.3}
                        step={0.01}
                        className="flex-1"
                        style={{
                          background: `linear-gradient(to right, 
                            oklch(${displayValues.lightness} 0.01 ${displayValues.hue}),
                            oklch(${displayValues.lightness} 0.15 ${displayValues.hue}),
                            oklch(${displayValues.lightness} 0.3 ${displayValues.hue})
                          )`,
                          borderRadius: "9999px",
                        }}
                      />
                      <span className="text-xs text-muted-foreground w-10 text-right">
                        {Math.round(displayValues.chroma * 100)}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Sidebar Item Size */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="flex items-center gap-2 text-sm font-medium">
                    <Rows3 className="w-4 h-4" />
                    Sidebar Item Size
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Adjust the density of playlist items in the sidebar
                  </p>
                </div>
                <div className="flex gap-2">
                  {(["small", "medium", "large"] as const).map((size) => (
                    <Button
                      key={size}
                      variant={sidebarItemSize === size ? "default" : "outline"}
                      size="sm"
                      onClick={() =>
                        setSidebarItemSize(size as SidebarItemSize)
                      }
                      className="capitalize"
                    >
                      {size}
                    </Button>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Progress Bar Style */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">
                    Progress Bar Style
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Choose between waveform or simple progress bar
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant={
                      progressBarStyle === "waveform" ? "default" : "outline"
                    }
                    size="sm"
                    onClick={() => setProgressBarStyle("waveform")}
                    className="gap-1.5"
                  >
                    <Activity className="w-4 h-4" />
                    Waveform
                  </Button>
                  <Button
                    variant={
                      progressBarStyle === "simple" ? "default" : "outline"
                    }
                    size="sm"
                    onClick={() => setProgressBarStyle("simple")}
                    className="gap-1.5"
                  >
                    <div className="w-4 h-0.5 bg-current rounded-full" />
                    Simple
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* About */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
        >
          <Card>
            <CardHeader>
              <CardTitle>About Ferrotune</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Client Version</span>
                <span className="font-medium">1.0.0</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Protocol</span>
                <span className="font-medium">OpenSubsonic</span>
              </div>
              <Separator />
              <p className="text-sm text-muted-foreground">
                Ferrotune is a modern music player for your personal music
                library. Built with Next.js and powered by the OpenSubsonic API.
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
