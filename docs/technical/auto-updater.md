# Yachiyo Claw update system

Yachiyo Claw does not contact Chatbox update or telemetry services. Updates are
published as GitHub Releases in `Wayne1145/yachiyo-claw`.

## Sources

- Release API: `https://api.github.com/repos/Wayne1145/yachiyo-claw/releases/latest`
- Release page: `https://github.com/Wayne1145/yachiyo-claw/releases`
- Desktop packages: `electron-updater` with the GitHub publisher configured in
  `electron-builder.yml`.
- Android/Web: `useVersion` checks the public Release API and links the user to
  the Release page. Android never uses `electron-updater`.

The checker sends only the standard GitHub `Accept` header. It does not send a
device id, account id, API key, or analytics payload. A repository with no
published Release yet returns "up to date" (HTTP 404).

## Desktop flow

`src/main/app-updater.ts` performs a startup check after five seconds and then
checks hourly when `autoUpdate` is enabled. It uses a single GitHub feed,
prevents concurrent checks, downloads an available package automatically, and
installs it on the next quit. Renderer events are exposed through the existing
`updater:*` IPC channels and rendered in the About page/sidebar.

There is no automatic About dialog on startup. Users see update state in the
About page or the desktop update banner.

## Android/Web flow

`src/shared/releases/yachiyo.ts` owns version normalization and semver
comparison. `src/renderer/hooks/useVersion.ts` calls this checker every two
hours while the About page can link directly to Releases. Android update
installation is intentionally not attempted from the WebView; users install
the APK from the published Release assets.

## Verification

```powershell
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm exec vitest run src/shared/releases/yachiyo.test.ts src/renderer/hooks/useVersion.test.ts
```

For a desktop package, build with `electron-builder --publish never` and verify
that the generated package metadata points to the Yachiyo Claw GitHub owner and
repository. Never add a Chatbox CDN fallback or telemetry endpoint.
