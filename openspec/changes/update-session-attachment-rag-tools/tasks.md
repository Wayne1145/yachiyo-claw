## 1. Implementation

- [x] 1.1 Add retrieval-mode attachment tags and reminders to context construction.
- [x] 1.2 Add session attachment RAG tools to `buildToolsForSession`.
- [x] 1.3 Remove generation-time automatic pre-query evidence injection.
- [x] 1.4 Allow sending while retrieval attachments are indexing or failed so the model can respond from tool-visible status.
- [x] 1.5 Add PoC eval script for model tool-use behavior.
- [x] 1.6 Create separate local fixture repository with synthetic documents and cases.

## 2. Verification

- [x] 2.1 Add unit coverage for retrieval attachment context tags.
- [x] 2.2 Add unit coverage for session attachment RAG tool registration.
- [x] 2.3 Run target unit tests.
- [ ] 2.4 Run eval harness against a real model endpoint.
