# Bundled speech recognition model

Yachiyo Claw bundles the int8 files from
`sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16` for
offline Chinese and English speech recognition.

- Runtime: sherpa-onnx v1.13.4, Apache-2.0
- Upstream: https://github.com/k2-fsa/sherpa-onnx
- Model archive: https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16.tar.bz2
- Archive SHA-256: `2b7c63322b32e5e0f2526043a1103366119ca58dd615cd7105a37c01db9553d7`

Only the quantized encoder, decoder, joiner, and token table are packaged.
