# Third-party notices

Yachiyo Claw is licensed under GPLv3. Components retain their original licenses.

## Android Linux sandbox

The optional Android Linux sandbox packages PRoot 5.1.107.86 and runtime
dependencies built by the Termux project. PRoot is GPL-2.0-or-later, libtalloc
is LGPL-3.0-or-later, and libandroid-shmem uses its upstream permissive license.
Package recipes and corresponding sources are available at
https://github.com/termux/termux-packages.

The sandbox downloads the official Alpine Linux 3.24 mini root filesystem on
first use. Alpine package copyrights and licenses remain available inside the
installed root filesystem and at https://www.alpinelinux.org.

## On-device models

The Android local model runtime uses Google LiteRT-LM under Apache-2.0. The
runtime integration follows the public AI Edge Gallery implementation at
https://github.com/google-ai-edge/gallery.

Local text embeddings use Google MediaPipe Tasks Text under Apache-2.0.

Offline Chinese and English speech recognition uses sherpa-onnx v1.13.4 under
Apache-2.0 and the quantized
`sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16` model
published with the upstream pretrained ASR assets. The exact source archive
and checksum are recorded in `android/app/src/main/assets/asr/NOTICE.md`.

## Document parsing

PDF parsing uses Mozilla PDF.js under Apache-2.0. DOCX parsing uses JSZip under
MIT. Apache Commons Compress is used to validate and unpack Linux sandbox
archives under Apache-2.0.
