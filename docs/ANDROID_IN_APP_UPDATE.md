# Android In-App Update Release Gate

Yachiyo Claw checks the latest stable GitHub Release at startup when automatic updates are enabled. Android only advertises a non-debug APK when GitHub supplies a valid SHA-256 asset digest or the Release contains a matching `.sha256` sidecar.

The native updater accepts only HTTPS assets under:

```text
https://github.com/Wayne1145/yachiyo-claw/releases/download/
```

It follows downloads only to GitHub's release asset CDN, stores the APK under the app-private cache, verifies SHA-256 after download and again before installation, and checks the APK package ID. Android PackageManager performs the final signer and signing-lineage verification.

## 0.0.5 To Next Version

Before building, update `package.json` and Android `versionName` to the same stable `x.y.z` value. Increase Android `versionCode` above `5`. Do not reuse a tag or version code.

Build the release APK with the same NewDreamStudio signing key used for `0.0.5`. Create a sidecar without modifying the APK:

```powershell
$releaseDir = '.cache/release/v0.0.6'
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
$apk = Join-Path $releaseDir 'yachiyo-claw-v0.0.6.apk'
Copy-Item -LiteralPath 'android/app/build/outputs/apk/release/app-release.apk' -Destination $apk
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $apk).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$apk.sha256" -Encoding ascii -NoNewline -Value "$hash  yachiyo-claw-v0.0.6.apk`n"
```

Run the local gate against the previously published `0.0.5` APK. The script verifies version progression, file size, sidecar integrity, APK signatures and signer continuity:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm verify:android-update-release -- --apk .cache/release/v0.0.6/yachiyo-claw-v0.0.6.apk --previous-apk .cache/release/v0.0.5/yachiyo-claw-v0.0.5.apk
```

Upload both the APK and its `.sha256` file to a draft Release. Complete the normal release gates, publish it, and then fetch the published metadata without exposing credentials in project files:

```powershell
gh api repos/Wayne1145/yachiyo-claw/releases/tags/v0.0.6 | Set-Content -Encoding utf8 .cache/release-v0.0.6.json
```

Run the metadata gate immediately after publication with `--release-json`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm verify:android-update-release -- --apk .cache/release/v0.0.6/yachiyo-claw-v0.0.6.apk --previous-apk .cache/release/v0.0.5/yachiyo-claw-v0.0.5.apk --release-json .cache/release-v0.0.6.json
```

The metadata gate rejects drafts and prereleases. A draft is checked locally with the APK/signature gate and is published only after all Android milestone checks pass.

## Device Upgrade Smoke Test

1. Install the signed `0.0.5` APK on Android 11, 13 and 15/16 test devices.
2. Keep automatic updates enabled and launch the app.
3. Confirm the update dialog names the next version and that dismissing it does not start a download.
4. Download in-app and verify progress reaches 100% without writing an APK to shared storage.
5. Deny unknown-source access once; confirm the app shows the permission guidance and retains the verified download.
6. Grant access, return to Yachiyo Claw and install. Android must present the package installer as an update, not a new package.
7. Confirm conversations, encrypted provider credentials and agent settings remain intact after upgrade.
8. Repeat with a deliberately modified APK/sidecar in a private test Release; the app must reject it before the installer opens.
