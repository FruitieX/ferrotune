# Tauri Android App Implementation TODO

This document tracks the implementation of a Tauri Android app for Ferrotune with native audio playback support for background playback and lockscreen controls.

## Overview

The app embeds the existing Vite/React web UI in a Tauri WebView. Audio playback is handled by Android's native ExoPlayer via MediaSessionService to enable:
- Background audio playback (app minimized, screen off)
- Lock screen media controls
- Bluetooth metadata and controls
- Notification media controls

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Tauri Android App                        │
├─────────────────────────────────────────────────────────────┤
│  WebView (Vite/React)                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ React UI ←→ hooks.ts ←→ tauri.ts (bridge)           │   │
│  └─────────────────────────────────────────────────────┘   │
│                           ↓↑ invoke/listen                   │
├─────────────────────────────────────────────────────────────┤
│  Tauri Core (Rust)                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ tauri-plugin-native-audio (commands.rs)              │   │
│  └─────────────────────────────────────────────────────┘   │
│                           ↓↑ JNI                            │
├─────────────────────────────────────────────────────────────┤
│  Android Native (Kotlin)                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ PlaybackService (MediaSessionService + ExoPlayer)    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## TODO Checklist

### Phase 1: Tauri Project Setup

- [x] **1.1** Install Tauri CLI and API packages in client
  ```bash
  cd client
  pnpm add @tauri-apps/cli @tauri-apps/api
  ```

- [x] **1.2** Initialize Tauri project
  ```bash
  npx tauri init
  ```
  Configure:
  - App name: `ferrotune`
  - Window title: `Ferrotune`
  - Frontend dev URL: `http://localhost:3000`
  - Frontend dist: `out` (Vite build output)
  - Dev command: `pnpm run dev`
  - Build command: `pnpm run build`

- [ ] **1.3** Initialize Android support
  ```bash
  npx tauri android init
  ```
  **Note:** Requires JAVA_HOME and ANDROID_HOME environment variables set.
  See `flake.nix` for nix-shell with Android SDK.

- [ ] **1.4** Add Rust Android targets
  ```bash
  rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android
  ```
  **Note:** In nix, these are added via the flake's rust toolchain.

- [ ] **1.5** Verify Tauri setup
  ```bash
  npx tauri info
  ```

- [ ] **1.6** Test basic Android build (without custom plugin)
  ```bash
  pnpm run build
  npx tauri android build --debug
  ```

### Phase 2: Custom Audio Plugin - Rust Core

- [x] **2.1** Create plugin directory structure
  ```
  client/tauri-plugin-native-audio/
  ├── Cargo.toml
  ├── src/
  │   ├── lib.rs          # Plugin registration
  │   ├── commands.rs     # Tauri commands
  │   ├── error.rs        # Error types
  │   └── mobile.rs       # Mobile-specific code
  ├── android/
  │   └── (Kotlin code)
  ├── guest-js/
  │   ├── index.ts        # TypeScript API
  │   └── types.ts        # Types
  ├── package.json
  └── tsconfig.json
  ```

- [x] **2.2** Create `Cargo.toml` for plugin

- [x] **2.3** Implement `lib.rs` - plugin registration and init

- [x] **2.4** Implement `commands.rs` with commands:
  - `play` - Start/resume playback
  - `pause` - Pause playback  
  - `stop` - Stop playback completely
  - `seek` - Seek to position (ms)
  - `set_track` - Set current track (url, title, artist, album, artwork url)
  - `get_state` - Get current playback state
  - `set_volume` - Set volume (0.0-1.0)

- [x] **2.5** Implement `error.rs` - Error types

- [x] **2.6** Implement `mobile.rs` - Mobile platform initialization

### Phase 3: Custom Audio Plugin - Android (Kotlin)

- [x] **3.1** Create Android plugin structure
  ```
  android/
  ├── build.gradle.kts
  ├── src/main/
  │   ├── AndroidManifest.xml
  │   └── kotlin/com/ferrotune/audio/
  │       ├── NativeAudioPlugin.kt    # Tauri plugin class
  │       ├── PlaybackService.kt      # MediaSessionService
  │       └── AudioState.kt           # Shared state
  ```

- [x] **3.2** Create `build.gradle.kts` with dependencies:
  - androidx.media3:media3-exoplayer
  - androidx.media3:media3-session
  - androidx.media3:media3-ui

- [x] **3.3** Implement `NativeAudioPlugin.kt`
  - Extend `app.tauri.plugin.Plugin`
  - Annotate with `@TauriPlugin`
  - Implement `@Command` annotated methods for each Rust command
  - Bind to PlaybackService

- [x] **3.4** Implement `PlaybackService.kt`
  - Extend `MediaSessionService`
  - Create ExoPlayer instance
  - Create MediaSession
  - Handle play/pause/seek commands
  - Update metadata (title, artist, artwork)
  - Emit state change events back to Rust

- [x] **3.5** Implement `AudioState.kt`
  - Data classes for playback state
  - Track info
  - Event types

- [ ] **3.6** Update AndroidManifest.xml (in generated project)
  - Add FOREGROUND_SERVICE permission
  - Add FOREGROUND_SERVICE_MEDIA_PLAYBACK permission
  - Add INTERNET permission
  - Register PlaybackService
  **Note:** Plugin's AndroidManifest.xml is created. Permissions merge automatically.

### Phase 4: Custom Audio Plugin - TypeScript API

- [x] **4.1** Create `package.json` for guest-js

- [x] **4.2** Create `tsconfig.json`

- [x] **4.3** Implement `types.ts`
  - `PlaybackState` type
  - `TrackInfo` interface
  - Event payload types

- [x] **4.4** Implement `index.ts`
  - `play()` function
  - `pause()` function
  - `stop()` function
  - `seek(positionMs)` function
  - `setTrack(track)` function
  - `getState()` function
  - `setVolume(volume)` function
  - `onStateChange(callback)` event listener
  - `onProgress(callback)` event listener

### Phase 5: Frontend Integration

- [x] **5.1** Create `client/src/lib/tauri/index.ts`
  - `isTauri()` detection function
  - Re-export plugin API with fallbacks

- [x] **5.2** Create `client/src/lib/audio/native-engine.ts`
  - Native audio engine that uses Tauri plugin
  - Mirrors the interface of the HTML5 audio engine
  - Translates Jotai atoms to/from native events

- [x] **5.3** Modify `client/src/lib/audio/hooks.ts`
  - Import native engine conditionally
  - In `useAudioEngineInit()`:
    - Check `isTauri()`
    - If true, initialize native engine instead of HTMLAudioElement
  - In `useAudioEngine()`:
    - Route play/pause/seek to native when in Tauri
  - Keep browser code path unchanged

- [x] **5.4** Update `client/src/lib/api/client.ts`
  - Ensure `getStreamUrl()` returns absolute URLs (required for native player) ✅ Already returns absolute URL
  - Handle authentication in URL for ExoPlayer ✅ Auth params included

### Phase 6: Build System Integration

- [x] **6.1** Add plugin to `src-tauri/Cargo.toml`
  ```toml
  [dependencies]
  tauri-plugin-native-audio = { path = "../tauri-plugin-native-audio" }
  ```

- [x] **6.2** Register plugin in `src-tauri/src/lib.rs`
  ```rust
  tauri::Builder::default()
      .plugin(tauri_plugin_native_audio::init())
  ```

- [x] **6.3** Add permissions in `src-tauri/capabilities/default.json`

- [x] **6.4** Update `client/moon.yml` with Tauri tasks
  ```yaml
  tauri-dev:
    command: "npx tauri dev"
  tauri-android-dev:
    command: "npx tauri android dev"
  tauri-android-build:
    command: "npx tauri android build"
  ```

### Phase 7: Testing & Verification

- [ ] **7.1** Test Tauri desktop build (sanity check)
  ```bash
  npx tauri dev
  ```

- [ ] **7.2** Test Android build compiles
  ```bash
  npx tauri android build --debug
  ```

- [ ] **7.3** Test app launches on Android device
  ```bash
  npx tauri android dev
  ```

- [ ] **7.4** Test basic playback works

- [ ] **7.5** Test background playback (minimize app)

- [ ] **7.6** Test notification controls

- [ ] **7.7** Test lock screen controls

- [ ] **7.8** Test browser still works (regression)
  ```bash
  npm run dev
  # Open in browser, test playback
  ```

### Phase 8: Polish & Edge Cases

- [ ] **8.1** Handle audio focus (other apps playing audio)

- [ ] **8.2** Handle becoming noisy (headphones unplugged)

- [ ] **8.3** Handle errors (network failure, invalid track)

- [ ] **8.4** Implement queue support (next/previous from notification)

- [ ] **8.5** Persist playback state across app restarts

- [ ] **8.6** Add loading/buffering states

- [ ] **8.7** Update cover art in notification

---

## Current Progress

**Started:** 2026-01-12
**Last Updated:** 2026-01-12
**Status:** Core implementation complete. Phases 2-6 done. Phase 1 pending Android init.

### What's Done
- ✅ Tauri CLI and API installed
- ✅ Tauri project initialized
- ✅ Native audio plugin (Rust core)
- ✅ Android Kotlin implementation (PlaybackService, NativeAudioPlugin)
- ✅ TypeScript API for plugin
- ✅ Frontend integration (hooks.ts modified for conditional native/web audio)
- ✅ Moon tasks for Tauri development
- ✅ Nix flake updated with Android SDK support
- ✅ TypeScript compilation passes
- ✅ Vite build passes

### Next Steps
1. Enter Android nix shell: `nix develop .#android`
2. Initialize Android: `cd client && npx tauri android init`
3. Test the Android build: `npx tauri android build --debug`
4. Test on device: `npx tauri android dev`

### Environment Setup for Android Development

To continue Android development, enter the Android-enabled nix shell:
```bash
nix develop .#android
cd client
pnpm install  # Install dependencies including the local plugin
npx tauri android init
npx tauri android dev  # Or: moon run client:tauri-android-dev
```

---

## Notes

### Development Environment Requirements

- Android Studio with:
  - Android SDK Platform (API level 24+)
  - Android SDK Platform-Tools
  - NDK (Side by side)
  - Android SDK Build-Tools
  - Android SDK Command-line Tools
- Rust with Android targets
- Java JDK 17+

### Future iOS Support

When implementing iOS:
- Use AVAudioSession for background audio
- Use MPNowPlayingInfoCenter for lock screen controls
- Use MPRemoteCommandCenter for remote controls
- Create parallel iOS implementation in `ios/` directory of plugin

### Resources

- [Tauri Android Prerequisites](https://v2.tauri.app/start/prerequisites/#android)
- [Tauri Mobile Plugin Development](https://v2.tauri.app/develop/plugins/)
- [Android Media3 Getting Started](https://developer.android.com/media/media3/exoplayer/hello-world)
- [MediaSessionService Guide](https://developer.android.com/media/media3/session/background-playback)
