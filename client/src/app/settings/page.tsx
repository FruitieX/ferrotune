"use client";

import { useAtom, useSetAtom } from "jotai";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import {
  Settings as SettingsIcon,
  Server,
  Volume2,
  Repeat,
  Shuffle,
  Palette,
  LogOut,
  Check,
  ExternalLink,
  Music2,
  HardDrive,
  User,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { serverConnectionAtom } from "@/lib/store/auth";
import { volumeAtom, repeatModeAtom } from "@/lib/store/player";
import { isShuffledAtom } from "@/lib/store/queue";
import { clearQueueAtom } from "@/lib/store/queue";
import { 
  accentColorAtom, 
  customAccentHueAtom,
  customAccentLightnessAtom,
  customAccentChromaAtom,
  ACCENT_PRESETS,
  type AccentColor 
} from "@/lib/store/ui";
import { useRouter } from "next/navigation";
import { useEffect, useCallback, useState } from "react";
import { getClient } from "@/lib/api/client";
import { parseCssColorToOklch, clampOklchToSliderRanges } from "@/lib/utils/color";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsPage() {
  const router = useRouter();
  const { isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const isMounted = useIsMounted();
  const [connection, setConnection] = useAtom(serverConnectionAtom);
  const [volume, setVolume] = useAtom(volumeAtom);
  const [repeatMode, setRepeatMode] = useAtom(repeatModeAtom);
  const [isShuffled, setIsShuffled] = useAtom(isShuffledAtom);
  const [accentColor, setAccentColor] = useAtom(accentColorAtom);
  const [customHue, setCustomHue] = useAtom(customAccentHueAtom);
  const [customLightness, setCustomLightness] = useAtom(customAccentLightnessAtom);
  const [customChroma, setCustomChroma] = useAtom(customAccentChromaAtom);
  const clearQueue = useSetAtom(clearQueueAtom);
  const { theme, setTheme } = useTheme();
  
  // Local state for OKLCH input to prevent cursor jumping while typing
  const [oklchInputValue, setOklchInputValue] = useState("");
  const [oklchInputFocused, setOklchInputFocused] = useState(false);

  // Sync preferences to server
  const syncPreferences = useCallback(async (color: AccentColor, hue?: number, lightness?: number, chroma?: number) => {
    const client = getClient();
    if (!client) return;
    
    try {
      await client.updatePreferences({
        accentColor: color,
        customAccentHue: color === "custom" ? hue : undefined,
        customAccentLightness: color === "custom" ? lightness : undefined,
        customAccentChroma: color === "custom" ? chroma : undefined,
      });
    } catch (error) {
      // Silently fail - preferences will be stored locally
      console.warn("Failed to sync preferences to server:", error);
    }
  }, []);

  // Load preferences from server on mount
  useEffect(() => {
    const loadPreferences = async () => {
      const client = getClient();
      if (!client) return;
      
      try {
        const prefs = await client.getPreferences();
        if (prefs.accentColor) {
          setAccentColor(prefs.accentColor as AccentColor);
        }
        if (prefs.customAccentHue !== undefined) {
          setCustomHue(prefs.customAccentHue);
        }
        if (prefs.customAccentLightness !== undefined) {
          setCustomLightness(prefs.customAccentLightness);
        }
        if (prefs.customAccentChroma !== undefined) {
          setCustomChroma(prefs.customAccentChroma);
        }
      } catch (error) {
        // Silently fail - use local preferences
        console.warn("Failed to load preferences from server:", error);
      }
    };
    
    if (isMounted && !authLoading) {
      loadPreferences();
    }
  }, [isMounted, authLoading, setAccentColor, setCustomHue, setCustomLightness, setCustomChroma]);

  // Compute display values: use preset values when a preset is active, custom values otherwise
  // This ensures sliders always show correct values even before the sync effect runs
  // Provide defaults to handle hydration edge cases
  const displayValues = accentColor === "custom" 
    ? { hue: customHue ?? 45, lightness: customLightness ?? 0.65, chroma: customChroma ?? 0.18 }
    : (() => {
        const preset = ACCENT_PRESETS.find(p => p.name === accentColor);
        return preset 
          ? { hue: preset.hue, lightness: 0.65, chroma: 0.18 }
          : { hue: customHue ?? 45, lightness: customLightness ?? 0.65, chroma: customChroma ?? 0.18 };
      })();

  // Sync custom atom values to preset values when a preset is active
  // This keeps the atoms in sync for when user switches to custom mode
  useEffect(() => {
    if (accentColor !== "custom") {
      const preset = ACCENT_PRESETS.find(p => p.name === accentColor);
      if (preset) {
        setCustomHue(preset.hue);
        setCustomLightness(0.65);
        setCustomChroma(0.18);
      }
    }
  }, [accentColor, setCustomHue, setCustomLightness, setCustomChroma]);

  const handleAccentColorChange = (color: AccentColor) => {
    setAccentColor(color);
    syncPreferences(color, customHue, customLightness, customChroma);
  };

  const handleCustomHueChange = (hue: number) => {
    setCustomHue(hue);
    if (accentColor === "custom") {
      syncPreferences("custom", hue, customLightness, customChroma);
    }
  };

  const handleCustomLightnessChange = (lightness: number) => {
    setCustomLightness(lightness);
    if (accentColor === "custom") {
      syncPreferences("custom", customHue, lightness, customChroma);
    }
  };

  const handleCustomChromaChange = (chroma: number) => {
    setCustomChroma(chroma);
    if (accentColor === "custom") {
      syncPreferences("custom", customHue, customLightness, chroma);
    }
  };

  const handleLogout = () => {
    setConnection(null);
    clearQueue();
    router.push("/login");
    toast.success("Logged out successfully");
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
    <div className="min-h-screen">
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

        {/* Playback Settings */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Music2 className="w-5 h-5" />
                Playback
              </CardTitle>
              <CardDescription>
                Audio playback preferences
              </CardDescription>
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
                <Select value={repeatMode} onValueChange={(v: string) => setRepeatMode(v as typeof repeatMode)}>
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
                  onCheckedChange={setIsShuffled}
                />
              </div>
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
              <CardDescription>
                Customize the look and feel
              </CardDescription>
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
                <div className="text-sm font-medium">
                  Accent Color
                </div>
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
                      style={{ backgroundColor: `oklch(0.65 0.18 ${preset.hue})` }}
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
                        style={{ backgroundColor: `oklch(${displayValues.lightness} ${displayValues.chroma} ${displayValues.hue})` }}
                      />
                      <input
                        type="text"
                        value={oklchInputFocused 
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
                          const parsed = parseCssColorToOklch(e.target.value.trim());
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
                        <span className="text-xs text-muted-foreground">Hue</span>
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
                        <span className="text-xs text-muted-foreground">Lightness</span>
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
                        <span className="text-xs text-muted-foreground">Saturation</span>
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
            </CardContent>
          </Card>
        </motion.div>

        {/* About */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
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

        {/* Logout */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="text-destructive flex items-center gap-2">
                <LogOut className="w-5 h-5" />
                Sign Out
              </CardTitle>
              <CardDescription>
                Disconnect from the server and clear your session
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="w-full">
                    <LogOut className="w-4 h-4 mr-2" />
                    Sign Out
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Sign out?</AlertDialogTitle>
                    <AlertDialogDescription>
                      You will be disconnected from the server and your playback
                      queue will be cleared.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleLogout}>
                      Sign Out
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
