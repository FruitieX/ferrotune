{
  description = "ferrotune";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    rust-overlay.url = "github:oxalica/rust-overlay";
    android-nixpkgs = {
      url = "github:tadfisher/android-nixpkgs";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, rust-overlay, android-nixpkgs }: flake-utils.lib.eachDefaultSystem (system:
    let
      overlays = [ rust-overlay.overlays.default ];
      pkgs = import nixpkgs { inherit system overlays; config.allowUnfree = true; };

      # Android SDK configuration
      androidSdk = android-nixpkgs.sdk.${system} (sdkPkgs: with sdkPkgs; [
        cmdline-tools-latest
        build-tools-35-0-0
        platform-tools
        platforms-android-35
        platforms-android-36
        ndk-27-2-12479018
      ]);

      rustToolchain = (pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml).override {
        extensions = [ "rust-src" "rust-analysis" "rustfmt-preview" "clippy-preview" ];
        targets = [
          "x86_64-unknown-linux-gnu"
          "x86_64-unknown-linux-musl"
          # Android targets for Tauri
          "aarch64-linux-android"
          "armv7-linux-androideabi"
          "x86_64-linux-android"
          "i686-linux-android"
        ];
      };

      postgresqlPackage = pkgs.postgresql_16;
    in {
      devShells = {
        default = pkgs.mkShell {
          name = "ferrotune";
          nativeBuildInputs = [
            pkgs.pkg-config
            pkgs.cmake
          ];
          buildInputs = [
            rustToolchain
            postgresqlPackage
            pkgs.openssl
            pkgs.nodejs_24
            pkgs.pnpm
            pkgs.docker-compose
            # Testing tools
            pkgs.hurl
            pkgs.ffmpeg
            pkgs.moon  # moon task runner
            pkgs.proto
            pkgs.cargo-watch  # for hot-reloading backend dev server
            pkgs.sqlite  # for database inspection
            pkgs.libopus # for transcoding to Opus
            pkgs.libclang.lib # needed for bindgen (bliss-audio aubio bindings)
            # Tauri desktop dependencies (for building plugin on desktop)
            pkgs.glib
            pkgs.cairo
            pkgs.pango
            pkgs.gdk-pixbuf
            pkgs.gtk3
            pkgs.webkitgtk_4_1
            pkgs.librsvg
            pkgs.libsoup_3
            # Playwright browser dependencies (Chromium headless shell)
            pkgs.nss
            pkgs.nspr
            pkgs.cups
            pkgs.libdrm
            pkgs.mesa
            pkgs.libgbm
            pkgs.libxkbcommon
            pkgs.expat
            pkgs.dbus
            pkgs.freetype
            pkgs.fontconfig
            pkgs.alsa-lib
            pkgs.libpulseaudio
            pkgs.xorg.libX11
            pkgs.xorg.libXcomposite
            pkgs.xorg.libXdamage
            pkgs.xorg.libXrandr
            pkgs.xorg.libXfixes
            pkgs.xorg.libXtst
            pkgs.xorg.libXi
            pkgs.xorg.libXext
            pkgs.xorg.libXrender
          ];
          shellHook = ''
            export PATH="${postgresqlPackage}/bin:$PATH"
            export LIBCLANG_PATH="${pkgs.libclang.lib}/lib"
            # Playwright Chromium needs these at runtime
            export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath [
              pkgs.glib pkgs.cairo pkgs.pango pkgs.gdk-pixbuf pkgs.gtk3
              pkgs.nss pkgs.nspr pkgs.cups pkgs.libdrm pkgs.mesa pkgs.libgbm
              pkgs.libxkbcommon pkgs.expat pkgs.dbus pkgs.freetype pkgs.fontconfig
              pkgs.alsa-lib pkgs.libpulseaudio pkgs.udev pkgs.atk
              pkgs.at-spi2-atk pkgs.at-spi2-core pkgs.xorg.libxcb
              pkgs.xorg.libX11 pkgs.xorg.libXcomposite pkgs.xorg.libXdamage
              pkgs.xorg.libXrandr pkgs.xorg.libXfixes pkgs.xorg.libXtst
              pkgs.xorg.libXi pkgs.xorg.libXext pkgs.xorg.libXrender
            ]}"
            echo "Loaded ferrotune dev shell (server + ui)"
            echo "Test tools: hurl, ffmpeg, moon available"
          '';
        };

        # Shell with Android SDK for Tauri mobile development
        android = pkgs.mkShell {
          name = "ferrotune-android";
          nativeBuildInputs = [
            pkgs.pkg-config
            pkgs.cmake
          ];
          buildInputs = [
            rustToolchain
            postgresqlPackage
            pkgs.openssl
            pkgs.nodejs_24
            pkgs.pnpm
            pkgs.docker-compose
            # Testing tools
            pkgs.hurl
            pkgs.ffmpeg
            pkgs.moon
            pkgs.proto
            pkgs.sqlite
            pkgs.libopus
            pkgs.libclang.lib # needed for bindgen (bliss-audio aubio bindings)
            # Android development
            androidSdk
            pkgs.jdk17
          ];
          LIBCLANG_PATH = "${pkgs.libclang.lib}/lib";
          ANDROID_HOME = "${androidSdk}/share/android-sdk";
          ANDROID_SDK_ROOT = "${androidSdk}/share/android-sdk";
          NDK_HOME = "${androidSdk}/share/android-sdk/ndk/27.2.12479018";
          JAVA_HOME = "${pkgs.jdk17}";
          shellHook = ''
            export PATH="${postgresqlPackage}/bin:$PATH"
            echo "Loaded ferrotune Android dev shell"
            echo "ANDROID_HOME=$ANDROID_HOME"
            echo "NDK_HOME=$NDK_HOME"
            echo "JAVA_HOME=$JAVA_HOME"
            echo ""

            # Auto-configure ADB bridge when running in a VM
            # Points the Android SDK's ADB client at the host-side ADB server
            # where the Android device/emulator is connected.
            if [ -n "''${ANDROID_ADB_SERVER_ADDRESS:-}" ]; then
              echo "Using pre-configured ADB server: $ANDROID_ADB_SERVER_ADDRESS"
            elif grep -qi microsoft /proc/version 2>/dev/null; then
              # WSL2 mirrored networking mode shares localhost with Windows
              WINDOWS_HOST="''${ADB_WINDOWS_HOST:-127.0.0.1}"
              export ANDROID_ADB_SERVER_ADDRESS="$WINDOWS_HOST"
              echo "WSL2 detected: ADB bridged to Windows host at $WINDOWS_HOST"
            fi
            if [ -n "''${ANDROID_ADB_SERVER_ADDRESS:-}" ]; then
              echo "  (ANDROID_ADB_SERVER_ADDRESS=$ANDROID_ADB_SERVER_ADDRESS)"
              echo "  Make sure the Windows ADB server is running with:"
              echo "  > adb -a nodaemon server"
            fi

            echo ""
            echo "To initialize Android for Tauri (first time):"
            echo "  cd client && npx tauri android init"
            echo ""
            echo "To verify emulator connectivity:"
            echo "  bash scripts/connect-android-emulator.sh"
            echo ""
            echo "To run on Android emulator:"
            echo "  moon run client:tauri-android-dev"
            echo ""
            echo "Deploy (debug):"
            echo "  moon run client:tauri-android-deploy"
            echo ""
            echo "Deploy (release, requires keystore env vars):"
            echo "  moon run client:tauri-android-deploy-release"
            echo "  Required: FERROTUNE_RELEASE_KEYSTORE, FERROTUNE_RELEASE_KEYSTORE_PASSWORD,"
            echo "            FERROTUNE_RELEASE_KEY_ALIAS, FERROTUNE_RELEASE_KEY_PASSWORD"
            echo ""
            echo "Logs:"
            echo "  adb logcat -v color,threadtime -s ReplayGainProcessor:* PlaybackService:* NativeAudioPlugin:* Tauri:* chromium:* NativeAudio:* Tauri\/Console:*"
          '';
        };
      };
    }
  );
}