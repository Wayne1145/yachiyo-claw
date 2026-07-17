# Yachiyo Claw Engineering Guide

## Scope

Yachiyo Claw is an Android-first, GPLv3 AI chat and local-agent application. Keep the Chatbox provider and conversation layers reusable while Android-only privileged capabilities stay behind typed native interfaces.

## Local Toolchains

All downloaded toolchains and caches must remain under the workspace:

- `.tools/`: Corepack, Android SDK, NDK, and other pinned tools.
- `.cache/`: pnpm, npm, Gradle, and Android user caches.
- `.research/`: upstream source audits and downloaded documentation.
- `.models/`: development model weights.

Use `scripts/yachiyo-env.ps1` to run package and Android commands so proxy and cache paths are consistent.

## Verification

Run the smallest relevant check after each change. The Android host gate before every Android milestone is:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm check
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm test:android-foundation
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm run check:android-native-logs
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm run mobile:sync:android
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 gradle testDebugUnitTest
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 gradle assembleDebug
```

Milestones that touch shared Provider/conversation code, and every public release, also run `pnpm test` and `pnpm build:web`. A known upstream failure needs an exact recorded baseline and tracking item; never report it as passing or mix it into Android regression counts. Device-sensitive changes require Android 11, 13, and 15/16 emulator or hardware smoke tests before the milestone is complete.

## Safety Boundaries

- API keys and privileged credentials must use Android Keystore-backed encryption.
- Model output never invokes shell, ADB, Shizuku, root, accessibility, or device actions directly. Every call passes through the Tool Broker policy and audit layer.
- Destructive or externally visible actions require explicit, parameter-level confirmation by default.
- Add short comments around permission-sensitive or non-obvious code; avoid narrating straightforward assignments.
