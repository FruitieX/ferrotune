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
    in {
      devShells = {
        default = pkgs.mkShell {
          name = "ferrotune";
          buildInputs = [
            rustToolchain
            pkgs.pkg-config
            pkgs.postgresql
            pkgs.openssl
            pkgs.nodejs_24
            pkgs.docker-compose
            # Testing tools
            pkgs.hurl
            pkgs.ffmpeg
            pkgs.moon  # moon task runner
            pkgs.proto
            pkgs.sqlite  # for database inspection
            pkgs.cmake # needed for libopus
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
          ];
          shellHook = ''
            export LIBCLANG_PATH="${pkgs.libclang.lib}/lib"
            echo "Loaded ferrotune dev shell (server + ui)"
            echo "Test tools: hurl, ffmpeg, moon available"
          '';
        };

        # Shell with Android SDK for Tauri mobile development
        android = pkgs.mkShell {
          name = "ferrotune-android";
          buildInputs = [
            rustToolchain
            pkgs.pkg-config
            pkgs.postgresql
            pkgs.openssl
            pkgs.nodejs_24
            pkgs.docker-compose
            # Testing tools
            pkgs.hurl
            pkgs.ffmpeg
            pkgs.moon
            pkgs.proto
            pkgs.sqlite
            pkgs.cmake
            pkgs.libopus
            # Android development
            androidSdk
            pkgs.jdk17
          ];
          ANDROID_HOME = "${androidSdk}/share/android-sdk";
          ANDROID_SDK_ROOT = "${androidSdk}/share/android-sdk";
          NDK_HOME = "${androidSdk}/share/android-sdk/ndk/27.2.12479018";
          JAVA_HOME = "${pkgs.jdk17}";
          shellHook = ''
            echo "Loaded ferrotune Android dev shell"
            echo "ANDROID_HOME=$ANDROID_HOME"
            echo "NDK_HOME=$NDK_HOME"
            echo "JAVA_HOME=$JAVA_HOME"
            echo ""

            # Auto-configure ADB bridge when running under WSL2
            # Points the Android SDK's ADB client at the Windows-side ADB server
            # where the Android emulator is running.
            # WSL2 mirrored networking mode shares localhost with Windows, so
            # 127.0.0.1 reaches the Windows ADB server directly.
            if grep -qi microsoft /proc/version 2>/dev/null; then
              # Allow override via env var; default to localhost (mirrored networking)
              WINDOWS_HOST="''${ADB_WINDOWS_HOST:-127.0.0.1}"
              export ANDROID_ADB_SERVER_ADDRESS="$WINDOWS_HOST"
              echo "WSL2 detected: ADB bridged to Windows host at $WINDOWS_HOST"
              echo "  (ANDROID_ADB_SERVER_ADDRESS=$WINDOWS_HOST)"
              echo "  Make sure the Windows ADB server is running:"
              echo "  > PowerShell (Admin): scripts\\setup-windows-adb-for-wsl.ps1"
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
          '';
        };
      };
    }
  );
}