# Session Attachment RAG Evaluation

> Last updated: 2026-05

This document records the automated test workflow for the session attachment RAG PoC.

## What To Validate

Session attachment RAG is model-driven: large file content is not injected into the prompt. The prompt contains
`<ATTACHMENT_FILE>` tags and a `<SYSTEM_REMINDER>`, and the model must decide when to call retrieval tools.

The eval suite checks:

- positive cases: file-dependent questions call `query_session_attachment`;
- implicit positive cases: the user asks "that mission", "this setup", or a follow-up question without saying "search
  the file";
- multi-document routing: the model chooses the relevant attachment;
- negative cases: unrelated math, writing, or general-knowledge questions do not call retrieval.

## Fixture Repository

Default local path:

```bash
../../chatbox-session-rag-eval-fixtures
```

The fixture repo contains:

- synthetic long documents with hidden, non-pretrained "needle" facts;
- Wikipedia-derived real documents with source attribution and CC BY-SA notes;
- JSON cases shared by the standalone and Chatbox-flow harnesses.

Regenerate fixtures:

```bash
cd ../../chatbox-session-rag-eval-fixtures
node scripts/generate-fixtures.mjs
node scripts/fetch-real-fixtures.mjs
```

## Standalone Harness

Use this for fast tool-use behavior checks against an OpenAI-compatible endpoint:

```bash
CHATBOX_EVAL_BASE_URL="https://your-openai-compatible-endpoint/v1" \
CHATBOX_EVAL_MODEL="your-model" \
CHATBOX_EVAL_API_KEY="your-api-key" \
pnpm eval:session-rag
```

Dry-run fixture loading:

```bash
pnpm eval:session-rag -- --dry-run
```

## Chatbox Conversation Flow

Use this when validating product behavior end to end. It exercises Electron, renderer config loading, license loading,
local API routing, file upload, session attachment indexing, tool registration, model calls, and persisted messages.

Start the local API first. Then build the app with the local API flag because the renderer origin is compiled in:

```bash
USE_LOCAL_API=true node ./node_modules/electron-vite/bin/electron-vite.js build --mode development
pnpm eval:session-rag:chatbox -- --case long-citrine-threshold --keep-user-data
```

The harness copies the real `config.json` into a temporary userDataDir and sets `SESSION_ATTACHMENT_RAG_DB_PATH` to a
separate temp sqlite path. It does not mutate the real app profile.

## Lessons From Debugging

- The "too large for chat attachments" message is a capability failure, not necessarily a byte-size failure. For large
  desktop attachments, `session_attachment_embedding` must be enabled by the local API/license response.
- `USE_LOCAL_API=true` must be present during renderer build. Passing it only when launching Electron is not enough.
- A valid conversation must have a selected model. The eval harness injects `settings.defaultChatModel` into the temp
  config when the copied config does not define one.
- A fixed CDP port is fragile. The harness allocates a free port for each run.
- The submit action must be verified by observing textarea clear/session creation. Pressing Enter was not reliable in
  Playwright for this input box.
- DB indexing readiness and persisted message readiness are separate. Before context building, the message file metadata
  must persist `sessionAttachmentIndexStatus: "ready"`; otherwise the model receives an indexing reminder and will not
  query.

## High-Signal Cases

```bash
pnpm eval:session-rag:chatbox -- --case long-citrine-threshold
pnpm eval:session-rag:chatbox -- --case implicit-citrine-current-policy
pnpm eval:session-rag:chatbox -- --case implicit-multi-doc-release-followup
pnpm eval:session-rag:chatbox -- --case real-wiki-apollo-implicit-landing-site
pnpm eval:session-rag:chatbox -- --case multi-turn-real-wiki-apollo-followup
pnpm eval:session-rag:chatbox -- --case unrelated-simple-math
pnpm eval:session-rag:chatbox -- --case real-wiki-unrelated-capital
```
