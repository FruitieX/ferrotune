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
            echo "To initialize Android for Tauri:"
            echo "  cd client && npx tauri android init"
          '';
        };
      };
    }
  );
}