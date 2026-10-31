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
        build-tools-36-0-0
        platform-tools
        platforms-android-35
        platforms-android-36
        platforms-android-37-0
        ndk-27-2-12479018
        emulator
        system-images-android-36-google-apis-x86-64
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
            pkgs.nodejs_26
            pkgs.pnpm
            pkgs.docker-compose
            # Testing tools
            pkgs.hurl
            pkgs.lsof  # for killing stale Vite preview in E2E global-setup
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
            pkgs.libx11
            pkgs.libxcomposite
            pkgs.libxdamage
            pkgs.libxrandr
            pkgs.libxfixes
            pkgs.libxtst
            pkgs.libxi
            pkgs.libxext
            pkgs.libxrender
          ];
          shellHook = ''
            export PATH="${postgresqlPackage}/bin:$PATH"
            export LIBCLANG_PATH="${pkgs.libclang.lib}/lib"
            # Playwright's downloaded Chromium runs through nix-ld. Use this
            # shell's glibc loader so it matches the libraries below instead
            # of the host's (possibly older) glibc.
            export NIX_LD="$(cat ${pkgs.stdenv.cc}/nix-support/dynamic-linker)"
            # Playwright Chromium needs these at runtime
            export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath [
              pkgs.glib pkgs.cairo pkgs.pango pkgs.gdk-pixbuf pkgs.gtk3
              pkgs.nss pkgs.nspr pkgs.cups pkgs.libdrm pkgs.mesa pkgs.libgbm
              pkgs.libxkbcommon pkgs.expat pkgs.dbus pkgs.freetype pkgs.fontconfig
              pkgs.alsa-lib pkgs.libpulseaudio pkgs.udev pkgs.atk
              pkgs.at-spi2-atk pkgs.at-spi2-core pkgs.libxcb
              pkgs.libx11 pkgs.libxcomposite pkgs.libxdamage
              pkgs.libxrandr pkgs.libxfixes pkgs.libxtst
              pkgs.libxi pkgs.libxext pkgs.libxrender
            ]}"
            echo "Loaded ferrotune dev shell (server + ui)"
            echo "Test tools: hurl, ffmpeg, moon available"
          '';
        };

        # Shell with Android SDK for the native Android client
        android = pkgs.mkShell {
          name = "ferrotune-android";
          buildInputs = [
            androidSdk
            pkgs.jdk17
            pkgs.moon
            pkgs.nodejs_26 # Kotlin DTO codegen (android:generate-bindings)
            pkgs.pnpm # Tauri Android client build (client:tauri-android-build-ci)
            # Tauri Android builds compile the Rust app, which needs the same
            # native deps as the default shell (aubio/bindgen, Opus linking).
            pkgs.pkg-config
            pkgs.cmake
            pkgs.libclang.lib
            pkgs.libopus
          ];
          ANDROID_HOME = "${androidSdk}/share/android-sdk";
          ANDROID_SDK_ROOT = "${androidSdk}/share/android-sdk";
          # Tauri's Android build reads NDK_HOME (the moon tasks pass it through).
          NDK_HOME = "${androidSdk}/share/android-sdk/ndk/27.2.12479018";
          JAVA_HOME = "${pkgs.jdk17}";
          LIBCLANG_PATH = "${pkgs.libclang.lib}/lib";
          shellHook = ''
            echo "Loaded ferrotune Android dev shell"
            echo "ANDROID_HOME=$ANDROID_HOME"
            echo "JAVA_HOME=$JAVA_HOME"
            echo ""

            echo ""
            echo "Build debug APK:  moon run android:assemble-debug"
            echo "Unit tests:       moon run android:test-unit"
            echo "Lint:             moon run android:lint"
            echo "Install (debug):  moon run android:install-debug"
            echo ""
            echo "Logs:"
            echo "  adb logcat -v color,threadtime -s PlaybackService:* Ferrotune:* AndroidRuntime:*"
          '';
        };
      };
    }
  );
}