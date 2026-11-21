# Realtime voice UI - local 0.0.24 candidate

No Git push or public release. Source and app data preserved.

- Interactive mode selector: chat / Agent / Realtime. Remains visible and enabled, including during calls and collapsed controls.
- Realtime has no typing composer; start/end/cancel, microphone input mute, camera, and output mute are separate actions. Switching modes closes an active call.
- Missing credentials show a dismissible configuration dialog and link to the Realtime settings page.
- Interactive settings contain a persistent 0-1 VAD threshold with a live volume overlay. Optional local microphone test releases tracks on close and stops before native call capture. Meter uses normalized RMS in dB, a visual guide rather than an exact server speech-probability scale.
- Threshold updates are debounced, use the correct GA / DashScope schema, and retain existing instructions and tools. Silence duration remains 650 ms.
- Camera enable during a call requests per-call approval before frames are sent. Starting with an already enabled camera follows the same policy.
- About version is displayed immediately from native app info, regardless of release-server availability. Package version 0.0.24, Android versionCode 24.

Verification: full frontend run 2060 passed, 54 skipped, zero failed. Final targeted protocol/runtime/lifecycle tests passed after GA update-type fix. Type check, lint and native sensitive-log gate passed; lint has existing warnings. Android debug tests 126 passed and APK build passed using explicit mobile sync before Gradle (host PowerShell spawn limitation documented in previous verification report).

MuMu Android 12: real-time selection, no typing, missing-config dialog, mic/camera/mute controls, compact toggle, return to chat, camera live frame, explicit microphone test, touch-drag threshold and persistence, 1440x3200 portrait and 1920x1080 landscape inspected. Device native app info and About both show 0.0.24 / 24. Display restored to 1440x3200; threshold restored to 50%; test audio/camera stopped.

Still pending: real upstream Realtime model audio/video exchange; Android 11/13/15-16 hardware gates. Do not equate UI/protocol tests with live-provider certification.

Rollback: .cache/checkpoints/20261024-realtime-ui retains the previous 0.0.23 APK and previous-media source patch/new-file archive. Original tracked baseline remains in .cache/checkpoints/20261023-interactive/HEAD-fd90b9c.zip. Reconstruct selected business files only; preserve infrastructure/user edits. Never uninstall or clear app data to roll back. Android may reject a lower versionCode; use a properly versioned rollback build rather than deleting data.
