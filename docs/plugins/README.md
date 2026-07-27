# Yachiyo Claw Plugin SDK

Third-party plugins are ZIP packages loaded into a dedicated Web Worker created by an opaque-origin
sandbox frame. They do not receive the Capacitor bridge or host DOM; the opaque origin blocks app
storage, and the inherited frame CSP blocks ambient network and subresource requests. All host calls
are pure-data RPC calls checked against the package digest and the user's per-capability decision.

## Create or build a plugin

Generate a complete project and an immediately installable ZIP:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm plugin:create -- --id demo-plugin --name "Demo Plugin"
```

The scaffold requests only `storage`, `ui`, and `tools`. It emits a persistent counter, a
host-rendered page, a namespaced Agent tool, a local declaration file, and a reproducible build
script. Editing the package changes its digest and intentionally requires fresh consent.

Build the repository example:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm exec node scripts/build-example-plugin.mjs
```

Install `examples/plugins/hello-yachiyo/hello-yachiyo.zip` from Settings > Plugins. Generated ZIPs are
development artifacts and should not be committed.

Create an ECDSA P-256 signing key outside the repository, then emit the digest/signature fields for a
marketplace entry:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm exec node scripts/sign-plugin-package.mjs examples/plugins/hello-yachiyo/hello-yachiyo.zip path/to/private-key.pem publisher-key-id
```

The private key is read only from the explicit path and is never copied into the package or catalog.

The repository's minimal signed marketplace can be rebuilt with:

```powershell
$env:YACHIYO_EXAMPLE_PLUGIN_SIGNING_KEY='D:\\keys\\plugin-publisher-p256.pem'
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 pnpm exec node scripts/build-example-marketplace.mjs
```

Without that environment variable the marketplace build fails. The supplied private key must match
the public trust root bundled in the app; the key is never generated, copied, or committed by the
script.

## Package contract

- `yachiyo-plugin.json` is required at the ZIP root and uses schema version 1.
- Scripted plugins bundle to one self-contained entry file. Imports and `require` are unavailable.
- Every installed file is declared with its decoded byte size and SHA-256 digest.
- A bundled declarative page is named by `contributions.view`; UI is validated and host-rendered.
- Agent tool names must be prefixed with `<plugin-id>_` and are re-authorized on every call.
- Network access is HTTPS-only, exact-host allow-listed, redirect checked, private-address denied, and
  rate/byte limited. Calls are cancelled when the Agent run stops. The plugin Worker has no direct
  `fetch`.
- Android authorization records and plugin key-value data are encrypted with an Android Keystore key
  before persistence. AES-GCM AAD binds each envelope to its exact plugin id and storage key, so
  moving ciphertext between plugin namespaces cannot make the host decrypt it for another plugin.

The dependency-free authoring surface in `src/shared/plugins/sdk.ts` exports manifest, view, selector,
host-call, and tool handler types plus identity helpers. The scaffold copies a standalone declaration
into each generated project, so authors do not need this repository or a monorepo. See
[the authoring guide](../plugin-platform/authoring.md).

## Installation and updates

The app supports local ZIP side-loading, direct HTTPS packages, GitHub repositories with a release
asset named `yachiyo-plugin.zip`, and a signed marketplace catalog. Android package transfers use the
same persistent downloader as models, updates, sandbox images, Skills, and themes.

Plugin code is installed into immutable version directories. Updating changes only the registry's
active-version pointer; failed updates preserve the old code. Retained versions can be rolled back,
which revokes all capabilities and requires fresh consent.

Marketplace entries follow `src/shared/plugins/marketplace.ts`. Marketplace packages require a
supported package signature, SHA-256 digest, and a signer public key already bundled as an official
trust root in the installed app. A remote catalog cannot introduce its own trusted signer.
`plugin-marketplace/index.json` is the default catalog in this repository.

## Host APIs

The type contract is exported from `src/shared/plugins/sdk.ts`. A plugin can call only methods covered
by a capability it declared and the user granted:

- `storage.get`, `storage.set`, `storage.remove`, `storage.keys`: encrypted, plugin-namespaced KV data.
- `network.fetch`: bounded HTTPS requests to exact manifest domains.
- `sandbox.readFile`, `sandbox.writeFile`, `sandbox.exec`: a plugin-specific `/workspace` inside the
  Android PRoot environment. Writes and commands pass through the Agent approval policy and audit log.
- `device.observe`, `device.find`, `device.click`, `device.setText`, `device.scroll`, `device.launch`,
  `device.keyevent`: accessibility-backed device operations. Device mutations require a parameter-bound,
  single-use native approval nonce.

## Security boundary

Plugin code runs in an opaque-origin Worker, not a cryptographic virtual machine. It never receives the
DOM or Capacitor bridge, cannot open the app's origin storage, and inherits a no-egress CSP from its
sandbox frame. Every supported host call is bound to the currently executing plugin principal and entry
digest. The host serializes invocations, propagates aborts, enforces per-method schemas and quotas, and
records privileged work through the Tool Broker. WebView engine vulnerabilities remain a residual risk.

Linux access still shares the installed PRoot system image, although each plugin gets a private
workspace. PRoot is not a kernel security boundary; commands can use its network and change the shared
root filesystem. Device access has stricter gates: the package signature must verify against a
marketplace trust root bundled in the app, the user must grant `device` separately after installation,
conversation phone control and the global device gate must both be enabled, and each mutation receives
a fresh parameter-bound native approval nonce.

Read [the security review](../plugin-platform/security-review.md) before publishing a marketplace
package.
