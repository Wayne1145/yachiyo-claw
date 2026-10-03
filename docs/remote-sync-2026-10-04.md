# Remote integration and acceptance plan (2026-10-04)

This checkpoint integrates remote source and repairs the reported Agent layout
divergence. Device acceptance and publication are waiting for the user's approval.
The audit below covers the incoming changes and their overlap with local fixes;
it is not a claim that every application feature is correct.

## Source inventory

- Previous base: `e38418d`.
- Incoming `origin/main`: `cf7d88eca72ea74256cdf5b1b07cfe0ab447cd8f`
  (13 new commits, also the commit behind the annotated `v0.0.22` tag).
- Local recovery checkpoint: `4d6b19d`.
- Integration branch: `codex/integrate-remote-v0.0.22-20261003`.
- `v0.0.21` and `v0.0.22` are published, non-draft, non-prerelease GitHub
  releases. Their publication times are 2026-10-01 01:40:46 and 13:31:44 CST.
- All origin branch heads and tags were fetched. The old human branch
  `codex/release-v0.0.17` is already contained in main. No other independent
  feature branch was found.

## Integration decisions

- Keep incoming settings navigation/forms/confirmation redesign, keyboard and
  rotated safe-area fixes, and old-WebView compatibility changes.
- Keep the recovered Live2D binary, binary-safe Git attributes, canvas lifecycle
  changes, and runtime diagnostics. Retain local imported-model metadata through
  the incoming MOC header parser, avoiding a second parser implementation.
- Keep incoming hardlink extraction/accounting, runtime dependency recovery,
  Ubuntu installation error reporting, and x86_64 PRoot syscall compatibility.
- Retain local token streaming, LiteRT context bucketing, system theme sync,
  guest DNS, bounded Ubuntu retries, and scoped process cleanup.
- Retain removal of Chatbox commercial onboarding, cloud search and paid-service
  pages. Do not restore deleted modules through incoming imports or route trees.
- Keep the remote XML parser as a development dependency, remove the duplicate
  older runtime dependency, and install the merged manifest with a frozen lockfile.
- Remove unused desktop rerank code and preserve typed native-file-path helpers.
- Preserve existing stash and `.workbuddy/`; neither is a release artifact.

## Agent layout repair

The mode switch previously navigated from the normal conversation to a task page
with a separate message renderer and extra composer borders, padding and width
rules. On Android the task page now uses the normal message renderer, linked
character avatar, normal empty state, and the same composer structure. Task
submission, cancellation, tool results and settings remain owned by the task.
Normal-chat edit/retry actions are disabled for task presentation so they cannot
modify the wrong storage record. Reasoning changes explicitly update task settings.

Three new component tests cover system-message hiding with tool-result retention,
the shared empty state, and task-owned send/stop/reasoning operations. This is code
verification; visual equivalence still needs device screenshots and interaction.

## Findings to address before release

1. **Sandbox runtime recovery race (P2):** `prepareRuntimeFiles` uses only a Java
   class monitor while the foreground app and `:sandbox` service can write the same
   `libtalloc.so.2.partial` from separate processes. Protect the complete restore
   sequence with a cross-process lock, then test concurrent cold-cache startup.
2. **Cancellation can miss descendants (P2):** `killProcessTree(Process)` destroys
   the parent before reading its `/proc` children. Capture descendants before
   terminating the parent and verify a second independent sandbox job survives.
3. **Actions PR #14 is not merge-ready:** `bc2883a` upgrades ten Actions and fails
   Android CI because setup-android 4.0.4 installs command-line tools under `22.0`
   (or `latest`) while validation expects the build-ID directory `15859902`.
   Locate the actual sdkmanager installation before checking its revision. Do not
   merge the failing branch unchanged.
4. **PR #7 is obsolete:** it updates shell-quote in the deleted `release/app`
   desktop tree. Do not restore that directory merely to merge the PR.

The two sandbox findings are recorded, not fixed in this source-sync checkpoint.
The incoming Android automatic glass quality changed from reduced to balanced;
frame time and WebGL stability need device verification. Incoming interactive
replies are persistent and manually collapsible, and model/persona controls moved
into the panel. This differs from the earlier five-second bubble behavior and
needs a product decision, rather than being silently declared equivalent.

The upstream release records themselves leave the real-API Tetris workflow,
complete Ubuntu toolchain/runtime separation, and in-app update installation
acceptance incomplete. Published release status does not close these gaps.

## Host verification

- Frozen-lockfile dependency installation: passed.
- TypeScript and generated routes: passed.
- Full Vitest: 271 files passed, 2 skipped; 2023 tests passed, 54 skipped.
- Lint: exit 0, 956 warnings, no errors; not a warning-free claim.
- Native log privacy gate: passed, 120 source files.
- Mobile resource sync and Web production build: passed. Existing bundle-size
  and mixed static/dynamic import warnings remain.
- Gradle `testDebugUnitTest assembleDebug -x syncAndroidWebAssets`: BUILD
  SUCCESSFUL; the already completed mobile sync was reused without rebuilding it.
  XML reports contain 40 suites, 126 tests, zero failures/errors and two skipped
  symlink-dependent cases on Windows.
- After the Gradle success report and APK creation, the redirected PowerShell
  wrapper stayed open with only Gradle/Kotlin daemons remaining. Its terminal was
  interrupted to close the lingering session (wrapper exit 1). Native test
  results above come from the completed XML reports, not that wrapper exit code.
- A fresh debug APK was generated. It has not been installed or device-tested
  for this checkpoint. The previous v0.0.20 MuMu smoke result is not acceptance
  evidence for these merged changes.

## Device acceptance after user confirmation

1. Preserve app data and verify the installed package/signature. Capture ordinary
   chat before and after repeated Agent toggles, including empty and populated
   conversations. Compare avatars, composer, model/persona/reasoning controls,
   attachments, tool outputs, scrolling, keyboard clearance and history continuity.
   Cover 1200x2608 and 1440x3200 portrait plus landscape, light and dark themes.
2. Use the configured Yachiyo API with `gpt-5.6-terra`, reasoning at most high.
   Complete: "Use HTML to write a Tetris game and deploy it locally on port 8080."
   Verify actual workspace files, server response and a playable page in Android.
   Check tool errors, retry, cancel, approvals while backgrounded, and navigation
   during streaming. Do not expose API credentials in logs or screenshots.
3. Exercise bundled Alpine and enabled Ubuntu separately: installation, DNS,
   shell, Python/Node child processes, Git, file edits, browser access, persistent
   jobs, stop/restart and plugin-disabled tool gating. Validate the two race fixes.
4. Load a small installed GGUF model, verify native runtime state and memory,
   receive streamed output, cancel, send another turn and unload. Test supported
   Gemma formats separately; do not infer arm64 phone performance from x86_64 MuMu.
5. Validate Live2D visibility, model switching, speech timing, mute, camera preview,
   keyboard/rotation, background recovery and frame time. Test settings navigation,
   language selection, Skills/MCP and memory persistence.
6. Verify download pause/resume and process restart, verified update installation,
   and Agent recovery. Distinguish normal process death from Android force-stop,
   which intentionally prevents automatic background starts.
7. Complete Android 11, 13 and 15/16 smoke coverage required by AGENTS.md. Record
   unavailable devices and skipped checks explicitly. Device evidence consists of
   ADB screenshots, sanitized logs, tool results and observed outcomes. Only then
   decide whether a new version is ready for GitHub publication.
