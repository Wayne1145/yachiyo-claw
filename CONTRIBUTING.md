# Contributing to Yachiyo Claw

Yachiyo Claw accepts GPL-3.0 contributions for its Android-first chat, Agent, local-model, Live2D,
Skills, MCP, plugin, and Vibe Coding features. Open an issue before a large architectural change so
the Android boundary, migration path, and test matrix can be agreed first.

## Development rules

- Keep downloaded toolchains and caches under `.tools/`, `.cache/`, `.research/`, or `.models/`.
- Run package and Android commands through `scripts/yachiyo-env.ps1`.
- Never commit credentials, signing keys, model weights, private logs, or generated APKs.
- Model output must not execute shell, accessibility, Shizuku, root, ADB, MCP, plugin, or device
  actions directly. Calls stay behind typed contracts and the Tool Broker policy/audit layer.
- Preserve Chatbox's reusable Provider/conversation layers and keep Android privileges behind native
  interfaces. Add comments only around non-obvious or permission-sensitive behavior.
- User-facing Yachiyo strings must use i18n. Device-sensitive UI changes need portrait and landscape
  screenshots at representative narrow/tall resolutions.

## Verification

Run the smallest relevant test while editing. Before an Android milestone, run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm check
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm test:android-foundation
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm run check:android-native-logs
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm run mobile:sync:android
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 gradle testDebugUnitTest
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 gradle assembleDebug
```

Changes to shared Provider/conversation code and public releases also run `pnpm test` and
`pnpm build:web`. Android 11, 13, and 15/16 smoke testing remains required for a public milestone;
record any unavailable device tier explicitly instead of reporting it as passed.

## Pull requests

Keep changes focused and explain behavior, risks, migrations, verification, and any remaining test
gaps. Screenshots are expected for visible Android changes. By submitting a contribution, you
confirm that you have the right to provide it under this repository's GPL-3.0 license.
