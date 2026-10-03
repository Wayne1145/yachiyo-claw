# Settings reconstruction validation — 2026-10-01

## Host checks

- TypeScript passed. Full Vitest: 274 files passed, 2 skipped; 2040 tests passed,
  54 skipped. The skipped integration cases require external conditions.
- Lint passed with existing warnings. Native log privacy check passed (117 files).
- Capacitor mobile synchronization and production Web builds passed.
- Full Gradle `testDebugUnitTest assembleDebug` passed. Native test reports contain
  126 tests: 124 passed, 2 skipped due to Windows symlink permissions.
- Subsequent UI packaging reused the native build. All 27 packaged native library
  SHA-256 values match the preceding complete native build.

## Android observations

- Android 11 / WebView 83: installed APK loaded its packaged `public` assets. All
  19 tested settings routes had one mounted page, uniform positive card radii,
  no horizontal overflow, and reachable bottom controls. The confirmation sheet
  measured 34px on all four corners, and cancel preserved the feature state.
- This device exposed invisible historical navigation titles that depended on
  `Animation.finished`, missing in WebView 83. Direct title replacement removed
  the accumulation. Explicit horizontal button padding fixed the unsupported
  logical-padding shorthand. Native screenshots exposed a black masked backdrop
  below settings; a painted fade removed it.
- Android 13 / WebView 109: installed APK route audit passed for all 19 pages.
  Confirmation cancellation and corner geometry passed. English labels and long
  descriptions remained within the viewport.
- Android 15 / WebView 124: final packaged APK passed all 19 routes in light and
  dark appearances, including expanded theme import fields and confirmation sheets.
- Additional Android 15 renderer checks passed at 1440×3200, 915×412 landscape CSS
  viewport, and 320×686 narrow CSS viewport. Search survives navigating into a
  result and returning, and clearing it restores all entries.
- With the software keyboard visible, the viewport resized from 915 to 530 CSS
  pixels; the settings search and the last speech field stayed above the keyboard.

## Artifact

- Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`, 195929218 bytes.
- SHA-256: `470ed24b7dc8fa119e791a978b3a080295ac869aeff1ec83719d1bd388e23c4e`.
- Signing certificate matches the existing release certificate:
  `60e81bcb2d72faf525d4dbfb952c956edbde60da93ac187b4f308df3bf4e9a23`.
- All packaged renderer files match the synchronized Android assets. The permission
  allowlist has 18 entries; no source maps or upstream telemetry endpoints were found.
- This is a development build for this settings change, not a replacement of the
  previously published v0.0.21 release. No physical handset was attached. These UI
  checks do not claim completion of the earlier real-API Agent acceptance workflow.

Raw logs, device state and screenshots remain in ignored `.cache/` directories.
