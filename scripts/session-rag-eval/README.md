# Session Attachment RAG Model Eval PoC

This PoC checks whether a model uses session attachment retrieval tools when a user question depends on an uploaded
file, and avoids retrieval when the question is unrelated.

For the reusable agent workflow, see `scripts/session-rag-eval/SKILL.md`. For technical context and debugging notes, see
`docs/technical/session-attachment-rag-eval.md`.

The fixture documents live in a separate local repository by default:

```bash
../../chatbox-session-rag-eval-fixtures
```

Run:

```bash
CHATBOX_EVAL_BASE_URL="https://your-openai-compatible-endpoint/v1" \
CHATBOX_EVAL_MODEL="your-model" \
CHATBOX_EVAL_API_KEY="your-api-key" \
pnpm eval:session-rag
```

You can also pass a Chatbox license as `CHATBOX_LICENSE_KEY`; the script uses it as the bearer token when `CHATBOX_EVAL_API_KEY` is not set.

Options:

```bash
pnpm eval:session-rag -- --fixtures-repo ../../chatbox-session-rag-eval-fixtures
pnpm eval:session-rag -- --case citrine-threshold
pnpm eval:session-rag -- --dry-run
```

This harness intentionally simulates the app's session attachment tools instead of launching Electron. It is meant to
compare model behavior around tool selection and query construction.

## Chatbox Conversation Flow

Use the real Chatbox Electron conversation flow when you need to verify local config, license loading, file upload,
session attachment indexing, tool calls, and persisted assistant messages together.

Start the local API first, then build the renderer with `USE_LOCAL_API=true` because the API origin is compiled into
the renderer bundle:

```bash
USE_LOCAL_API=true node ./node_modules/electron-vite/bin/electron-vite.js build --mode development
pnpm eval:session-rag:chatbox -- --case long-citrine-threshold --keep-user-data
```

The Chatbox-flow script copies the user's `config.json` into an isolated temporary userDataDir and points the session
RAG sqlite database at a separate temporary path, so the app reads the normal license and provider settings without
mutating the real app profile.

The script also:

- injects a temporary `settings.defaultChatModel` if the copied config lacks one;
- allocates a free CDP port per run;
- verifies the submit action by waiting for the textarea to clear;
- waits for session attachment indexing before sending;
- supports `turns` in fixture cases for multi-turn follow-up checks.

Useful cases:

```bash
pnpm eval:session-rag:chatbox -- --case implicit-citrine-current-policy
pnpm eval:session-rag:chatbox -- --case implicit-multi-doc-release-followup
pnpm eval:session-rag:chatbox -- --case real-wiki-apollo-implicit-landing-site
pnpm eval:session-rag:chatbox -- --case multi-turn-real-wiki-apollo-followup
pnpm eval:session-rag:chatbox -- --case real-wiki-unrelated-capital
```
