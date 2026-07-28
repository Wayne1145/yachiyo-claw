# Yachiyo Claw Privacy Notice

Last updated: 2026-07-28

This notice describes the official open-source Yachiyo Claw Android build published by
NewDreamStudio. A fork, custom build, model provider, MCP server, Skill, plugin, theme host, or model
repository can have different practices and terms.

## Summary

Yachiyo Claw is local-first. Conversations, settings, character profiles, memories, downloaded
models, knowledge indexes, Skills, plugins, themes, task state, and audit records are stored on the
device unless the user invokes a feature that needs an external service. The official Android build
does not initialize the upstream Chatbox analytics, Google Analytics, Plausible, or Sentry services,
and it does not send Yachiyo Claw usage analytics.

Local-first does not mean offline-only. The selected AI, speech, search, MCP, download, or plugin
service receives the data required to perform the requested operation. Its operator, rather than
Yachiyo Claw, controls its server-side retention and processing.

## Data kept on the device

The app can keep the following data in its private storage:

- conversations, attachments, session settings, forks, favourites, and generated summaries;
- provider configuration, API keys, OAuth tokens, and speech-service credentials;
- character profiles, user profile text, long-term memories, and local RAG indexes;
- local model files and metadata, Linux environment files, selected workspaces, and task checkpoints;
- installed Skills, plugins, themes, their grants and settings, and bounded execution/audit records;
- download metadata, partial files, verified update packages, and local diagnostic logs.

On Android, API keys, login tokens, protected settings, plugin grants/data, and other supported
sensitive records use AES-GCM encryption backed by a non-exportable Android Keystore key. Android
backup and device-transfer backup are disabled for the application. A rooted device, compromised OS,
or unlocked debug build can defeat application-level protections.

## Data sent when a feature is used

Yachiyo Claw makes external requests only for configured or user-invoked functionality, including:

- **AI providers:** prompts, conversation context, selected attachments or images, tool results, and
  model parameters are sent to the chosen provider. This includes the fixed Yachiyo API endpoint when
  that provider is selected.
- **Speech services:** local Sherpa-ONNX recognition stays on-device. A configured remote ASR service
  receives recorded audio; a remote TTS service, including the Edge/Bing template, receives the text
  to synthesize.
- **Search and retrieval:** web-search queries are sent to the selected search provider. An enabled
  remote MCP server receives the MCP requests and arguments shown by its configuration and tools.
- **Catalogs and downloads:** model searches and downloads contact Hugging Face or ModelScope.
  update checks contact GitHub. Skill discovery can contact `skills.sh`, SkillHub, or GitHub. Plugin
  and theme imports contact the marketplace or public HTTPS URL chosen by the user.
- **Regional download defaults:** until a regional choice has been initialized, app startup can make
  a short request to Cloudflare's `cdn-cgi/trace` endpoint and read only its two-letter country code.
  A `CN` result enables the optional Hugging Face and GitHub download mirrors by default. A failed
  check is retried on a later launch; manually saved mirror choices are never overwritten.
- **Optional mirrors:** when enabled, Hugging Face catalog/file requests can use `hf-mirror.com`, and
  Yachiyo Claw release assets can use `ghfast.top`. GitHub release metadata continues to come from
  GitHub. Mirror operators necessarily observe the requested URL and connection metadata; package
  hashes, package identity, signing lineage, and version progression are still verified locally.
- **Plugins:** an enabled plugin can make only the host calls covered by its declared and granted
  capabilities. A network grant exposes requests to the listed domains. A Linux sandbox grant can
  execute programs that make their own network connections and is therefore a high-risk permission.
- **Camera and device tools:** a camera image, screenshot, accessibility observation, file, or device
  result is sent to a model only when the corresponding feature and tool call are active. Sensitive
  fields are filtered where supported, but users should not expose secrets to an untrusted model.

Network services necessarily observe connection metadata such as the device IP address and TLS/HTTP
metadata. Yachiyo Claw does not add a stable advertising or analytics identifier to these requests.

## Android permissions

Permissions are requested for the feature that needs them:

- microphone and camera for speech input and camera-assisted conversations;
- notifications and foreground services for active downloads, Agent work, and local development jobs;
- overlay access for the visible Agent-operation and approval interface;
- accessibility, Shizuku, or root only after the user separately enables phone control;
- file access or a Storage Access Framework folder selected by the user for workspace import/export;
- install-unknown-apps permission only when installing a downloaded Yachiyo Claw APK update;
- battery-optimization exemption when the user chooses more reliable background operation.

The optional broad storage permission is not required for ordinary chat. Android system settings can
revoke permissions at any time, although revocation may stop an active task.

## Retention and deletion

Users can delete conversations, memories, downloaded models, Skills, plugins, themes, tasks, download
records, and local logs through the corresponding app screens. Plugin uninstall preserves only the
host audit history needed to explain prior privileged actions; uninstalling or clearing Yachiyo Claw
removes application-private data. The app cannot delete copies already submitted to an external
provider; use that provider's controls for server-side deletion.

Do not include API keys, passwords, private prompts, or personal device data in a public bug report.
For a security issue, follow [SECURITY.md](SECURITY.md). General privacy questions can be opened in the
[project issue tracker](https://github.com/Wayne1145/yachiyo-claw/issues) without attaching sensitive
logs or data.
