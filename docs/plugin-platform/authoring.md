# Yachiyo Claw plugin authoring

Yachiyo plugins are ZIP packages containing a strict manifest, declared files, an optional
self-contained JavaScript entry, and an optional declarative view. Plugin JavaScript runs in a
dedicated Worker and receives only the `yachiyo` pure-data API. It never receives DOM or Capacitor
objects.

## Quick start

```powershell
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm plugin:create -- --id demo-plugin --name "Demo Plugin"
cd plugins/demo-plugin
pnpm install
pnpm build
```

Install `plugins/demo-plugin/demo-plugin.zip` from **Settings > Plugins > Add plugin > Local ZIP**.
The generated page has a button, persists a counter in the plugin's private namespace, and returns
the updated host-rendered view. It also contributes `demo-plugin_echo` to Agent tools.

The scaffold copies `yachiyo-plugin.d.ts` into the project. This is the first SDK distribution format:
it works without a monorepo or runtime dependency and keeps a bundle self-contained. The canonical
richer type surface remains `src/shared/plugins/sdk.ts`.

There is intentionally no development bypass. Rebuild and reinstall after an edit. A changed entry
digest invalidates grants, so the user reviews the new package and grants capabilities again.
From the installed-plugin row, use **选择更新包** to pick the rebuilt ZIP without first uninstalling.
Android's file picker does not expose a durable raw path to WebView code, so the app asks you to pick
the file again instead of retaining broad storage access.

## Package layout

```text
demo-plugin.zip
|-- yachiyo-plugin.json
|-- main.js
`-- ui/
    `-- main.json
```

`yachiyo-plugin.json` and every declared file must use a safe package-relative path. Absolute paths,
drive letters, backslashes, empty path segments, `.`/`..`, symlinks, undeclared files, digest
mismatches, archive bombs, and over-quota packages are rejected before anything is installed.

## Manifest reference

| Field | Meaning |
|---|---|
| `schemaVersion` | Must be `1`. |
| `id` | Stable lowercase id such as `demo-plugin`; namespaces routes and tools. |
| `version` | Package version. Same-version reinstalls and implicit downgrades are rejected. |
| `displayName` | Plain-text user-visible name, at most 120 characters. |
| `description` | Plain-text user-visible description, at most 500 characters. |
| `capabilities` | Requested capabilities and a specific reason for each. |
| `contributions` | Optional view, settings entries, tab, and Agent tools. |
| `files` | Every package file with byte size and SHA-256. |

Optional identity and compatibility fields are `author`, `license`, and `minAppVersion`.

Scripted packages set `mode: "script-enabled"`, `entry`, and `entrySha256`. The entry must also appear
in `files`. Declarative packages use `mode: "declarative"` and omit all script fields.

Capability example:

```json
{
  "name": "network",
  "reason": "Read release metadata from the project's public API.",
  "domains": ["api.example.com"]
}
```

`reason` is shown verbatim to the user and must contain 10–500 characters. `network` requires exact
bare hostnames; wildcards, ports, schemes, localhost, and literal private addresses are rejected.

Contributions:

- `view`: a declared JSON file using the view schema below.
- `tab`: `label`, a `/plugin/<id>` route, order, and optional host icon.
- `settingsEntries`: up to 16 entries in `model`, `capability`, or `app` groups.
- `tools`: up to eight prompt-visible Agent tools. Names start with `<plugin-id>_`; risk is `read` or
  `act`; parameters use the restricted JSON Schema subset.

Tool schemas support `object`, `string`, `number`, `integer`, `boolean`, and `array`, plus enum,
required, descriptions, defaults, and basic bounds. They do not support `$ref`, regex patterns,
combinators, or arbitrary additional properties. Maximum depth is 3 and an object has at most 20
properties.

## Runtime entry

The entry is one self-contained classic script. Bundle dependencies into it. Imports, `require`, and
`importScripts` are unavailable.

```js
yachiyo.registerTool('demo-plugin_echo', async function (args) {
  const value = await yachiyo.host.call('storage.get', { key: 'last' })
  await yachiyo.host.call('storage.set', { key: 'last', value: JSON.stringify(args) })
  return { previous: value, current: args }
})
```

Host calls are valid only while a registered handler is actively executing. A plugin cannot start a
timer and later reuse an invocation identity. Arguments and results must be structured-cloneable JSON.
Use `yachiyo.log('log' | 'warn' | 'error', message)` for bounded diagnostics shown in the plugin's
activity log; do not log credentials or private user data.

## Host API

| Method | Capability | Request | Result and boundary |
|---|---|---|---|
| `storage.get` | `storage` | `{ key }` | String or `null`. |
| `storage.set` | `storage` | `{ key, value }` | Stores a string; per-key and namespace quotas apply. |
| `storage.remove` | `storage` | `{ key }` | Removes one key. |
| `storage.keys` | `storage` | `{}` | Lists at most 1,000 keys in this plugin namespace. |
| `network.fetch` | `network` | `{ url, method?, headers?, body? }` | HTTPS through the host proxy. Domain and every redirect hop are checked; headers, rate, URL, request, and response size are bounded. |
| `sandbox.exec` | `sandbox` | `{ command, timeoutMs? }` | User-approved command in the plugin workspace; 1–120 seconds and at most 30 starts/hour. |
| `sandbox.readFile` | `sandbox` | `{ path }` | Reads bounded text in the plugin workspace. |
| `sandbox.writeFile` | `sandbox` | `{ path, content }` | Writes bounded text after approval. |
| `device.observe` | `device` | `{}` | Reads the semantic accessibility snapshot. |
| `device.find` | `device` | A semantic selector | Finds a UI node. |
| `device.click` | `device` | A semantic selector | Clicks a matching node after per-action approval. |
| `device.setText` | `device` | Selector plus `value` | Sets matching node text after approval. |
| `device.scroll` | `device` | Selector plus direction | Scrolls a semantic node after approval. |
| `device.launch` | `device` | `{ packageName, activityName? }` | Launches an app after approval. |
| `device.keyevent` | `device` | `{ key: "BACK" | "HOME" | "RECENTS" }` | Sends an allowed global key after approval. |

A selector may contain `packageName`, `resourceId`, `text`, `contentDescription`, `role`, and
`ancestorSignature`; at least one field is required. Raw coordinate taps/swipes, shell, companion
devices, arbitrary Android intents, and direct native calls are not exposed.

`device` is never granted during installation and is disabled for unsigned packages. For a verified
package the user must separately open its detail page, read the full warning, confirm the package
identity and reason, and grant it. Calls still require phone control for the conversation, the global
device gate, Tool Broker checks, parameter-bound approval, and a single-use native nonce. Updating or
changing the entry digest revokes the grant.

The capability and method prefix are named `sandbox` for protocol compatibility, but the Android
backend is a shared PRoot Linux environment, not a kernel security boundary. A granted plugin can
use its toolchain to access the network and can modify the shared root filesystem. Treat `sandbox`
as the same risk class as unrestricted network access and grant it only to code you trust.

## Declarative views

A view has `schemaVersion: 1`, an optional title, and `children`. Supported nodes are:

- `text`, `heading`, `badge`, `progress`, `divider`, `codeBlock`, and `alert`
- `button`, `textInput`, `textarea`, `select`, and `switch`
- `list`
- `card`, the only container

Actions are data, never callbacks:

```json
{ "type": "invoke", "handler": "increment", "payload": { "step": 1 } }
```

The handler must be registered with `yachiyo.registerTool`. If it returns a valid view, the host
replaces the current view. Input controls merge their current value into the payload. Views are
limited to 200 nodes, depth 8, bounded text/list/options, and host-approved icons.

## What plugins cannot do

- No DOM, HTML, Markdown rendering, arbitrary CSS, free layout, canvas, WebGL, drag/drop, or custom
  components. A plugin submits declarative JSON and the host renders it.
- No direct `fetch`, `XMLHttpRequest`, WebSocket, WebTransport, EventSource, or dynamic script import.
  Network access uses `network.fetch` and only declared, granted domains.
- No direct Capacitor/native bridge, Android intent, shell, ADB, Shizuku, root, or accessibility API.
- No access to conversations, messages, attachments, memory, user profile, provider credentials,
  another plugin's data, host settings, or audit storage.
- No general filesystem access. `sandbox` paths stay in the plugin workspace.
- No ambient long-running Worker. Timeouts, cancellation, permission revocation, repeated crashes,
  and uninstall terminate it.
- No module loader. The entry must be a single bundled script.

These are product and security boundaries, not missing SDK conveniences.

## Signing and distribution

Marketplace packages require an ECDSA P-256 signature, catalog SHA-256, and an official signer public
key already bundled in the installed app. HTTPS, GitHub, and local ZIP installs may be unsigned but
are clearly labeled and can never receive `device`; a self-signature does not turn them into an
official marketplace package.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm exec node scripts/sign-plugin-package.mjs plugins/demo-plugin/demo-plugin.zip path/to/private-key.pem publisher-key-id
```

Keep the private key outside the repository. Publish the returned digest, size, signature, and public
key with the marketplace entry. Adding or rotating an official signer requires an app release that
adds its public key to the bundled trust roots before the catalog uses it. `minAppVersion` is checked
before load; incompatible manifest or protocol versions remain disabled instead of running with
changed semantics.

## Debugging and lifecycle

The plugin detail page shows health counters, recent errors, capability state, and bounded activity
and privileged-action audit data. Worker exceptions are plugin-scoped; repeated failures auto-disable
the package until the user explicitly re-enables it.

Updates are user-initiated and land in immutable version directories. Data is retained, expanded
permissions require consent, and `device` is always revoked on code updates. Failed versions do not replace the active
pointer. Up to three verified prior versions are retained for explicit rollback. Rollback does not
resurrect an old privileged grant.

Uninstall stops Workers and native jobs, cancels approvals, revokes grants, removes credentials/data,
and deletes all retained code/workspace data while preserving audit records.
