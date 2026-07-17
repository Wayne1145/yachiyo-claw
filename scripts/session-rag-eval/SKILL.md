---
name: session-rag-eval
description: Run and debug Chatbox session attachment RAG model evaluation with synthetic and real long-file fixtures.
---

# Session Attachment RAG Eval

Use this skill when validating file question-answering behavior for large chat attachments.

## Goal

Verify both sides of model behavior:

- The model calls `query_session_attachment` when the answer depends on an uploaded large file.
- The model avoids retrieval for clearly unrelated user requests.

Prefer the Chatbox conversation-flow harness for product validation because it exercises the real renderer, config,
license, local API, file upload, indexing, tool registration, and persisted messages.

## Fixtures

Default fixture repo:

```bash
../../chatbox-session-rag-eval-fixtures
```

Fixture types:

- synthetic long documents with hidden needle facts;
- Wikipedia-derived real long documents with source attribution;
- direct positive cases;
- implicit positive cases where the user does not explicitly ask to search the file;
- unrelated negative cases.

Regenerate fixtures in the fixture repo:

```bash
node scripts/generate-fixtures.mjs
node scripts/fetch-real-fixtures.mjs
```

## Chatbox Flow

Start the local API before running the harness. Then build with `USE_LOCAL_API=true`; the renderer API origin is compiled
into the bundle.

```bash
USE_LOCAL_API=true node ./node_modules/electron-vite/bin/electron-vite.js build --mode development
pnpm eval:session-rag:chatbox -- --case long-citrine-threshold --keep-user-data
```

The harness copies the real `config.json` into an isolated temporary userDataDir, injects a temporary default chat model
if missing, and stores the session RAG sqlite DB at a separate temporary path.

## Known Failure Modes

- "This attachment is too large..." means `session_attachment_embedding` capability is false or unavailable for the
  active local API/license path.
- If requests go to production, rebuild with `USE_LOCAL_API=true`.
- If Electron hangs at startup, check stale CDP/Electron processes. The harness now allocates a free CDP port.
- If the assistant says the file is still indexing after DB says ready, inspect the persisted user message. The message
  file must have `sessionAttachmentIndexStatus: "ready"` before context building.
- Do not trust a log line that says the message was submitted unless the textarea cleared and the session contains the
  user message.

## Useful Cases

```bash
pnpm eval:session-rag:chatbox -- --case long-citrine-threshold
pnpm eval:session-rag:chatbox -- --case implicit-citrine-current-policy
pnpm eval:session-rag:chatbox -- --case real-wiki-apollo-implicit-landing-site
pnpm eval:session-rag:chatbox -- --case multi-turn-real-wiki-apollo-followup
pnpm eval:session-rag:chatbox -- --case unrelated-simple-math
pnpm eval:session-rag:chatbox -- --case real-wiki-unrelated-capital
```

For fast model-behavior iteration without Electron:

```bash
pnpm eval:session-rag -- --dry-run
pnpm eval:session-rag -- --case implicit-citrine-current-policy
```
