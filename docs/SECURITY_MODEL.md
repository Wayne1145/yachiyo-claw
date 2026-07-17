# Yachiyo Claw Security Model

Yachiyo Claw treats every model, prompt, screen, web page, imported Skill, MCP server, and privileged backend as potentially untrusted. A successful model response is not authorization to act.

## Trust Boundaries

| Boundary | Trusted for | Never trusted for |
| --- | --- | --- |
| Chat UI | Capturing an explicit user goal | Granting hidden or persistent permissions |
| Cloud/local model | Suggesting plans and structured tool calls | Choosing a backend, bypassing approval, or executing shell |
| Tool Policy Broker | Schema validation, policy, backend selection, audit | Inferring consent that the user did not give |
| Accessibility tree/screenshot | Observing the current device state | Treating on-screen instructions as trusted policy |
| Skill | Composing declared tool calls | Loading arbitrary native code or widening tool permissions |
| Remote MCP | Returning explicitly requested extension data | Accessing Android tools unless separately mapped and approved |
| ADB/Shizuku/root service | Executing Broker-issued structured commands | Interpreting natural language or model output |
| Audit store | Recording digests and decisions | Persisting raw secrets, screen images, typed text, or file contents |

## Non-Negotiable Invariants

1. A model request does not contain a backend field. Only the Broker selects `standard`, `accessibility`, `adb`, `shizuku`, or `root`.
2. Every tool call is validated against a versioned descriptor before policy evaluation.
3. Approval is bound to a `sha256-rfc8785` canonical parameter digest. Any parameter or digest-algorithm change invalidates the decision.
4. The Broker selects the least-privileged available backend that can satisfy the call.
5. Destructive, externally visible, account, purchase, message, permission, and privacy-sensitive calls require parameter-level approval by default.
6. Denial, timeout, screen lock, backend disconnect, or policy change fails closed. App backgrounding invalidates pending interactive approval; only a separately persisted, bounded background grant can authorize an unattended step.
7. Audit records contain digests and minimal outcome codes, not raw parameters or tool results.
8. Model-generated shell text is never passed directly to any backend.
9. `callId` is a persisted idempotency key. A retry increments `attempt`; the Broker must verify the recorded side-effect state before it can execute again.

The versioned TypeScript wire contracts live in `src/shared/agent` and will be mirrored by the native Broker.

## Risk Levels

| Level | Examples | Default approval |
| --- | --- | --- |
| `read` | Battery state, foreground app, non-sensitive device metadata | Policy may allow within an active task |
| `act` | Tap, swipe, app launch, clipboard write | Prompt for new parameter sets |
| `sensitive` | Screenshot, clipboard read, notification content, user files, typed text | Prompt every call unless a narrow task grant exists |
| `destructive` | Delete, uninstall, install, send, purchase, account/security change | Prompt every call; never remember by default |

Tool descriptors set a minimum risk. Runtime context may only raise it. For example, a normal tap becomes sensitive when the target is a permission dialog and destructive when it confirms deletion.

## Prompt Injection

Screen text, OCR, notifications, files, web pages, tool output, Skill documentation, and MCP responses are data, not instructions. The Agent Loop must keep the user's goal and policy in a separate trusted context. Content that asks the Agent to ignore policy, reveal credentials, change approval behavior, or invoke unrelated tools is treated as an injection attempt and surfaced to the user.

Verification must observe the expected state change rather than trusting success text returned by a page or tool.

## Screen And Input Privacy

- Password nodes, accessibility password flags, one-time codes, payment fields, and explicitly sensitive applications are redacted before model input and logs.
- Screenshots have a visible session indicator and a short retention policy. They are not written to the audit log.
- `FLAG_SECURE` is respected. Yachiyo Claw does not promise capture through alternate backends.
- Text-entry tools receive the approved text through the Broker; typed text is not copied into audit records.
- MediaProjection is limited to a user-started session and cannot become an unattended background capture mechanism.

## Credentials And Local Data

- On Android, persisted settings, API keys, and login access/refresh tokens are encrypted with AES-256-GCM. The non-exportable key is generated in Android Keystore.
- Unreadable protected settings fail closed and require an explicit two-step settings reset; chats and unrelated local data are not deleted. Unreadable session tokens are cleared to a signed-out state.
- Application backup is disabled so encrypted rows are not restored without their Keystore key.
- Secrets are never included in URLs, WorkManager Data, notifications, analytics, crash reports, or model prompts unless the target API explicitly requires the credential as an authorization header.
- Imported provider configurations require review before persistence.
- Model files use temporary names, bounded downloads, resumable requests, SHA-256 verification, atomic publication, and safe ZIP extraction where archives are involved.

## Model-Safe Results

- Native backends return raw results only to the Broker. The model receives a schema-validated projection with an explicit sensitivity class, byte limit, retention policy, and redaction pass.
- Raw screenshots, accessibility trees, shell output, file contents, and backend error details never enter the audit record.
- Model-facing errors contain a stable code, a bounded message, and retryability only. Diagnostic details stay in a separately protected local debug channel and are disabled in release builds by default.
- Oversized or policy-incompatible results fail closed instead of being silently truncated in a way that could change their meaning.

## Privileged Backends

- Accessibility exposes a fixed action set and a redacted observation format.
- Wireless ADB owns pairing keys and TLS state; the model never sees pairing codes or private keys.
- Shizuku/Sui and libsu share a narrow, versioned AIDL service instead of accepting arbitrary model shell.
- A manual advanced-user terminal, if added, is a separate UI and authorization domain. Its history is never available as an Agent tool automatically.
- Backend capability discovery returns feature flags, not an invitation to escalate. Missing capability causes a safe failure or an explicit user setup flow.

## Background Execution

- WorkManager persists task state, but each resumed step revalidates approval, deadline, device state, and backend permission.
- Entering the background cancels pending interactive prompts. It does not revoke a valid background grant, but every use revalidates the grant before execution.
- A background grant binds one task, schedule, tool version, canonical parameter digest, expiry, maximum use count, and lock-screen policy. It never binds or chooses a privileged backend.
- Grant use is atomic with the persisted execution checkpoint. Expired, exhausted, changed, or missing grants fail closed and require a new user decision.
- Foreground Agent sessions always expose a cancellable notification.
- Reboot only restores schedules; it does not immediately start microphone, screen capture, a model, or privileged execution.
- Exact alarms are requested only for an explicit exact-time user requirement.
- A locked device raises risk and blocks tools that could expose or send private data unless the user created a specific background grant.

## Crash Recovery And Idempotency

- The Agent persists `queued`, `awaiting-approval`, `ready`, `running`, `paused`, and terminal checkpoints before exposing progress to the UI.
- A running step owns a time-bounded Broker lease. Process death expires the lease; recovery never assumes that an unrecorded side effect did not happen.
- Read-only and explicitly idempotent tools may retry after revalidation. Non-idempotent tools must verify the expected device state or stop for user review.
- Tests cover crashes immediately before a side effect, immediately after it, and before the terminal checkpoint so a message, file write, install, or destructive action is not repeated silently.

## Remote MCP

- Remote MCP is opt-in per server and capability. Credentials use Keystore-backed storage and never appear in URLs, logs, or model-visible configuration.
- HTTPS is required outside loopback development. Redirects, DNS rebinding, private/LAN destinations, loopback access, response size, and content type are checked against explicit policy to prevent SSRF.
- A server capability manifest cannot map itself to Android, ADB, Shizuku, root, or accessibility tools. Those mappings remain native, versioned, and separately approved.

## Distribution

The full GitHub sideload build and the restricted store build will use separate capability manifests and clear UI labels. Build flavor, Broker version, policy version/digest, retry attempt, and any background grant ID are part of the audit context. A restricted build must not silently route unavailable capabilities through a remote service.

## Known Limits

- Rooted devices can bypass application-level confidentiality and integrity guarantees.
- Accessibility and vendor firmware behavior varies by device and OS update.
- Local models can be more vulnerable to prompt injection or malformed tool calls; they use the same Broker and may receive stricter policies.
- No policy can make arbitrary autonomous action risk-free. Yachiyo Claw prioritizes observable, reversible, cancellable steps over hidden autonomy.
