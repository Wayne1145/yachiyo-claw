# Yachiyo API onboarding repair — 0.0.26 local candidate

The homepage previously fetched /models before persisting a key, required gpt-5.6,
and selected that fixed ID. Provider defaults and new-session defaults also carried
the retired preset. Saving now only validates a nonempty string and awaits the
existing Keystore-backed settings commit. It sends no chat/capability test request.

AndroidAppShell independently refreshes authenticated /v1/models on mount/key
changes. The service list replaces the catalog, preserves per-ID transport options,
retains available selections, otherwise picks a listed chat model. Empty results
or network errors do not roll back credentials. Other providers' global defaults
and nonempty conversations are not silently changed. Only unused Yachiyo drafts
with unavailable models adopt the discovered selection. Stale key responses and
unmounted results are ignored; cached models remain available after network errors.

Verification: targeted49 passed; full2076 passed/54 skipped/0 failed. TypeScript,
Web build and lint passed (961 pre-existing warnings). Native privacy gate125 files,
native131 tests and Debug build passed. Explicit Android asset sync preceded Gradle
with -x syncAndroidWebAssets due the documented host PowerShell-spawn limitation.

Independent Android13 read-only test instance on port5585: with Wi-Fi/data disabled,
homepage accepted a public fake test key and entered chat without waiting for the
network. No gpt-5.6 preset or horizontal overflow. A temporary native-HTTP stub then
returned a single non-preset model for GET /v1/models: provider settings and the empty
chat automatically selected it. Restart removed the stub; credentials and cached
selection remained. This is a controlled discovery test, not live upstream model
availability or inference certification. No paid chat requests were sent.

MuMu127.0.0.1:16384 refused connections during this task; no alternative unknown
device was used and no MuMu data was changed. APK: .artifacts/apk/yachiyo-claw-v0.0.26-preview.apk.
No source push or new public Release performed in this follow-up task.
