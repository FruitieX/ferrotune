# App Distribution

Ferrotune publishes app builds from the `main` branch through GitHub Actions. Each successful main-branch run creates a GitHub prerelease with a signed Android APK and unsigned desktop Tauri bundles.

## Android Release Signing

Android updates require every APK for `com.ferrotune.music` to be signed with the same key. Generate the release keystore outside the repository and keep an offline backup.

```bash
keytool -genkeypair \
  -v \
  -keystore ferrotune-release.jks \
  -alias ferrotune-release \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000
```

Add these repository secrets in GitHub:

| Secret | Value |
| --- | --- |
| `ANDROID_RELEASE_KEYSTORE_BASE64` | Base64-encoded `ferrotune-release.jks` |
| `ANDROID_RELEASE_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_RELEASE_KEY_ALIAS` | Key alias, for example `ferrotune-release` |
| `ANDROID_RELEASE_KEY_PASSWORD` | Key password |

Encode the keystore on Linux with:

```bash
base64 -w0 ferrotune-release.jks
```

If a device currently has an APK installed from `moon run client:tauri-android-deploy`, that build is signed with the Android debug keystore. Android will not update it in place with the release-signed APK. Uninstall the debug build once, then install the release-signed APK.

## GitHub Release Builds

The `CI` workflow publishes app builds only for successful `main` branch runs. Pull requests run tests and Docker build checks, but do not publish app release assets.

The app release jobs:

1. Wait for backend CI, client CI, and the Docker image build to pass.
2. Derive a monotonic app version from `GITHUB_RUN_NUMBER`.
3. Build the Android APK inside `nix develop .#android`.
4. Sign and verify the Android APK with `apksigner`.
5. Build unsigned Tauri desktop bundles on Linux, Windows, and macOS.
6. Create a prerelease tagged as `app-main-<versionCode>-<shortSha>`.
7. Keep only the latest app prereleases to avoid release clutter.

The Android asset is named like:

```text
ferrotune-android-universal-main-<versionCode>-<shortSha>.apk
```

Desktop artifacts are intentionally unsigned and not notarized in this first distribution path. Expect normal operating-system warnings on Windows and macOS.

## Obtainium Setup

Install Obtainium on each Android device, then add Ferrotune as a GitHub source:

```text
https://github.com/FruitieX/ferrotune
```

Use these settings:

- Enable prereleases.
- Use an APK asset filter matching `ferrotune-android-universal-main-.*\.apk`.
- Enable background update checks and notifications.

Obtainium removes the manual download step. Stock Android may still show an install confirmation prompt for sideloaded APK updates, depending on device settings and Android version.

## Local USB Deployment

Local USB deployment still uses the debug keystore and remains useful for development:

```bash
nix develop .#android
moon run client:tauri-android-deploy
```

Use GitHub release builds for the APKs that should update through Obtainium.