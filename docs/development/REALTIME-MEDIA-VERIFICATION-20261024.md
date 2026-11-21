# Media / Realtime / usage verification - 2026-10-24

Baseline: fd90b9c52d616a89945bbb9856a5396528a15108, app 0.0.23. No commit, push or release. Existing user changes and app data preserved.

## Automated checks

- TypeScript passed. Full Vitest: 2053 passed, 54 skipped, zero failed; 280 files passed and two skipped.
- Final targeted Realtime runtime / workspace preview tests: six passed, overlapping the full run rather than an additional aggregate.
- Full lint exited zero with 966 existing warnings; targeted new-file lint passed. Web build, Android resource sync and native sensitive-log gate passed.
- Final Android debug unit tests: 126 tests, 40 suites, zero failures/errors. Debug APK built and installed with install -r without clearing app data.
- Gradle syncAndroidWebAssets could not launch PowerShell on this host (CreateProcess error=5). The identical sync command was run explicitly, followed by testDebugUnitTest assembleDebug -x syncAndroidWebAssets --no-daemon. No unit tests were skipped by this workaround.

## MuMu Android 12

- Scoped serial 127.0.0.1:16384; no desktop mouse/keyboard control. Camera live frame 720x1280, readyState 4.
- Live2D high canvas 1030x1480; supersample 1648x2368, renderer ready. Original high setting restored.
- Realtime and usage settings render/scroll; save reachable. Phone button without credentials shows configuration guidance.
- Offscreen browser navigation, input, click, snapshot and screenshot passed without opening foreground UI. Explicit preview has separate navigation controls.
- Final browser wait finds an existing selector. Missing selector returns browser_wait_timeout after approximately 1.13 seconds for a one-second limit; visible document stays Yachiyo Claw.
- Portrait 1440x3200 and 1080x1920 inspected. Final 1920x1080 landscape (CSS 549x309) has visible/ready Live2D and in-bounds call controls. Screenshot: .cache/device/interactive-corrected-1920x1080.png. Resolution restored to 1440x3200.

## Pending user-assisted verification

- Real Realtime endpoint, exact model and voice: audio in/out, interruption, mute, camera frames, tools, transcripts and server usage need provider testing. User-specified model name is configurable, not certified available.
- Camera-to-vision-model round trip needs a compatible model.
- Actual Yachiyo sub2api billing did not return accessible supported data. Client parsing is tested; real multiplier/balance remains unverified, never assumed zero.
- Android 11, 13 and 15/16 unavailable; only Android 12 device tests performed.
- Offscreen WebView is not full desktop Chromium/Playwright. New OpenAI Live and Gemini Live protocols are not implemented.
- No background microphone/camera continuation or arbitrary multimedia history replay is claimed.

Rollback: .cache/checkpoints/20261023-interactive/ROLLBACK-20261024.md. Architecture: REALTIME-MEDIA-USAGE.md and Serena memory architecture/realtime-media-usage.
