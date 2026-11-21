# Realtime, media and usage architecture

Development snapshot: 2026-10-23, baseline `fd90b9c52d616a89945bbb9856a5396528a15108`.
This change is not a release; live-provider acceptance needs user-supplied credentials.

## Entry points and separation

- Interactive UI: `AndroidInteractive.tsx`, `useInteractiveRealtime.ts`.
- Protocol/config: `mobile/realtime-protocol.ts`, `mobile/realtime-settings.ts`.
- Session: `mobile/realtime-runtime.ts`; native transport/PCM: `media/YachiyoRealtimePlugin.java`.
- Context/tool assembly: `mobile/realtime-context.ts`; reuse `buildToolsForSession`, feature lifecycles, Tool Broker policy and audit. Never call raw shell/device methods from the Realtime event parser.
- Ordinary chat and Agent continue to use their existing stream loops. Realtime is explicitly started with the phone control; it does not invoke ordinary ASR/chat/TTS in parallel.
- API keys use context-bound Android Keystore encryption. WSS uses an Authorization header; query-string keys and cleartext remote endpoints are rejected. Native transport does not log media or secrets.
- Leaving the page or backgrounding the Activity ends capture/playback and the call. Background microphone foreground-service support is not claimed.

## Supported wire formats / unverified availability

- OpenAI Realtime GA: `session.update`, nested `audio.input/output.format`, PCM16 24 kHz, `response.output_audio.*` and function-call events. Assistant history uses `output_text` (not the legacy `text`).
- DashScope Qwen Omni: legacy `modalities`, PCM16 16 kHz input / 24 kHz output, `response.audio.*`, `input_image_buffer.append`.
- Model IDs, endpoints and voices are editable. The user-specified `Qwen3.8-Omni-Flash-Realtime` is retained as a configurable template, **not a certified available model**. Compatibility, voice names, image input and actual latency must be tested against the user's upstream.
- New OpenAI Live sessions (`/v1/live/sessions`, `session.start`) and Gemini Live are different protocols and are not implemented by these adapters.
- Continuous camera upload requires enabling camera, the separate video setting, and confirmation for that call. At most one frame/second is queued. The single-frame camera tool retains its existing approval policy.
- Native output starts mouth motion only when PCM is written for playback; muting suppresses playback, not generation. VAD interruption flushes queued audio. Tool errors are returned to the model, not left as unresolved calls.

## Context and persistence constraints

Realtime stores transcripts and brokered tool outcomes in the linked chat/task, using current-record update queues.
Server item observation time orders delayed ASR results. Updating a transcript must preserve its original position/time.
Recent text context is replayed (up to 30 messages, bounded text per message); historical audio/video bytes are not replayed.
Full arbitrary-length multimedia history replay and provider-specific context-limit discovery remain outside this implementation.

## Usage

- `mobile/usage-statistics.ts`: local 90-day/10,000-record metadata ledger; no prompts/keys/arguments.
- Chat and foreground Agent observe stream usage without changing control flow. Per-step counters and final aggregates are reconciled, not added twice. A regeneration gets a new accounting ID even if the visible message ID is reused.
- `media/YachiyoUsagePlugin.java`: native headless usage, merged by ID in the usage screen.
- Realtime uses `response.done.usage`. If the upstream reports no usage, the app does not invent token counts. Reasoning/cache are subsets, not extra tokens.
- Tool-call count and consumption of rounds containing tool calls are shown. These are **not exact standalone tool-schema token charges**, which typical upstream usage does not expose.
- Cache hit rate is calculated only from records that actually report cache information.
- `mobile/sub2api-billing.ts`: `GET /v1/sub2api/billing` for effective multiplier; `GET /v1/usage` for wallet balance / key quota / subscription remainder. Preserve reverse-proxy prefixes. Do not treat unsupported endpoints as zero balance. Credentials remain on the configured host; redirects are disabled.

## Browser

`workspace/BackgroundBrowser.java` is a UI-thread, offscreen Android WebView, without the Capacitor bridge.
Agent navigation/click/type/wait/snapshot/history/screenshot no longer starts an Activity.
Explicit user preview continues in `ControlledWebViewActivity`, now with navigation/address/progress controls.
This is a DOM browser fallback, **not a claim of desktop Chromium/Playwright equivalence**.
Navigation policy, safe browsing, file/content access restrictions and existing Tool Broker checks remain in effect.
`workspace_preview` now registers a URL without opening UI by default. `open=true` is for an explicit user request and requires approval. Routine validation uses the offscreen browser.
Browser wait results are parsed as JSON objects, not matched against an escaped string. High-density landscape uses the two-column layout from 480 CSS pixels, rather than waiting for 600.

## Source verification

Official references fetched into `.research/` through the local proxy:

- OpenAI Realtime conversation guide and official `openai/openai-node` Realtime types.
- `dashscope/dashscope-sdk-python`, `dashscope/audio/qwen_omni/omni_realtime.py`.
- Official `Wei-Shaw/sub2api` handlers `gateway_key_billing.go` and `gateway_handler.go`.

Do not mix the newer OpenAI Live protocol into Realtime GA, or infer support from a model's name alone.

## Rollback

The baseline archive and pre-existing infrastructure diff are in `.cache/checkpoints/20261023-interactive/`.
Restore only the business files listed in this task's manifest from `HEAD-fd90b9c.zip`; remove only explicitly listed task-new files.
Preserve `.serena`, `.codex`, `.agents`, `.workbuddy`, `.gitignore`, `tsconfig.json` and all unrelated user changes.
Never use a whole-worktree reset. No Git push or release is authorized by this task.
