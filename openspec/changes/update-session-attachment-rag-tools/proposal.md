# Change: Use model-driven tools for session attachment RAG

## Why

Session attachment RAG currently pre-queries uploaded files before model generation and injects retrieved evidence into the latest user message. That limits the model's ability to rewrite queries, use multi-turn context, and decide whether retrieval is necessary.

## What Changes

- Remove automatic pre-query evidence injection from the generation path.
- Expose session attachment RAG as a model toolset whenever large retrieval attachments are present and the model supports file tools.
- Add lightweight attachment tags and reminders for retrieval-mode files so the model notices uploaded files without receiving full content.
- Add a PoC model behavior evaluation harness with synthetic document fixtures in a separate local repository.

## Impact

- Affected specs: session-attachment-rag
- Affected code:
  - `src/shared/context/builder.ts`
  - `src/renderer/stores/session/tools-builder.ts`
  - `src/renderer/stores/session/orchestration.ts`
  - `src/renderer/packages/model-calls/toolsets/session-attachment-rag.ts`
  - `scripts/session-rag-eval/`
