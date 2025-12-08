{
  description = "ferrotune";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    rust-overlay.url = "github:oxalica/rust-overlay";
  };

  outputs = { self, nixpkgs, flake-utils, rust-overlay }: flake-utils.lib.eachDefaultSystem (system:
    let
      overlays = [ rust-overlay.overlays.default ];
      pkgs = import nixpkgs { inherit system overlays; };
      rustToolchain = (pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml).override {
        extensions = [ "rust-src" "rust-analysis" "rustfmt-preview" "clippy-preview" ];
        targets = [ "x86_64-unknown-linux-gnu" "x86_64-unknown-linux-musl" ];
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
          ];
          shellHook = ''
            echo "Loaded ferrotune dev shell (server + ui)"
            echo "Test tools: hurl, ffmpeg, moon available"
          '';
        };
      };
    }
  );
}
