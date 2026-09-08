# Third-Party Notices & Attributions

RYPER AI OS bundles, links to, or interfaces with third-party open-source software, models, and libraries. This document provides attributions and licensing notices for these components in compliance with their respective open-source licenses.

---

## Core Desktop Runtime

### 1. Electron
- **Project:** [Electron](https://www.electronjs.org/)
- **Copyright:** OpenJS Foundation and Electron contributors
- **License:** MIT License
- **Notice:** Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to standard MIT conditions.

### 2. Chromium
- **Project:** [The Chromium Project](https://www.chromium.org/)
- **Copyright:** The Chromium Authors, Google LLC
- **License:** BSD 3-Clause License, LGPL 2.1, and various open-source licenses
- **Notice:** Full Chromium component licensing notices are packaged with the Windows desktop application in `LICENSES.chromium.html` inside the application installation directory.

### 3. Node.js
- **Project:** [Node.js](https://nodejs.org/)
- **Copyright:** OpenJS Foundation and Node.js contributors
- **License:** MIT License and various open-source licenses

---

## Local AI & Speech Runtimes

### 4. llama.cpp
- **Project:** [llama.cpp](https://github.com/ggerganov/llama.cpp)
- **Author / Copyright:** Georgi Gerganov and llama.cpp contributors
- **License:** MIT License
- **Usage:** Embedded inference server (`llama-server.exe`) used for local GGUF model execution over localhost HTTP (`127.0.0.1:8080`).

### 5. whisper.cpp
- **Project:** [whisper.cpp](https://github.com/ggerganov/whisper.cpp)
- **Author / Copyright:** Georgi Gerganov and whisper.cpp contributors
- **License:** MIT License
- **Usage:** On-device speech recognition CLI runner (`whisper-cli.exe`) for transcribing user audio in push-to-talk voice interactions.

### 6. Piper (Neural Text-to-Speech)
- **Project:** [Piper](https://github.com/rhasspy/piper)
- **Author / Copyright:** Michael Hansen / Rhasspy
- **License:** MIT License
- **Usage:** On-device neural text-to-speech synthesizer (`piper.exe`) generating offline spoken audio responses.

---

## Models & Weights

### 7. Qwen 2.5 (Language Model)
- **Model:** Qwen 2.5 1.5B Instruct (GGUF Quantization)
- **Author / Organization:** Qwen Team, Alibaba Cloud
- **License:** [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- **Notice:** Licensed under the Apache License, Version 2.0. You may obtain a copy of the License at `http://www.apache.org/licenses/LICENSE-2.0`. Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

### 8. OpenAI Whisper Model Weights
- **Model:** Whisper Tiny / Base GGUF / GGML weights
- **Author / Organization:** OpenAI
- **License:** MIT License
- **Usage:** Acoustic model weights for speech-to-text transcription.

### 9. Piper Voice Models
- **Models:** `en_US-lessac-medium`, `hi_IN-pratham-medium`
- **Source:** Rhasspy / Piper Voice repository
- **License:** Open Data / Creative Commons / Public Domain (depending on respective dataset sources).

---

## Key Node.js & UI Libraries

| Package | License | Author / Copyright |
| :--- | :--- | :--- |
| **React** | MIT | Meta Platforms, Inc. and affiliates |
| **React DOM** | MIT | Meta Platforms, Inc. and affiliates |
| **Vite** | MIT | Yuxi (Evan) You and Vite contributors |
| **Tailwind CSS** | MIT | Tailwind Labs, Inc. |
| **Lucide React** | ISC | Lucide Contributors |
| **Zod** | MIT | Colin McDonnell and Zod contributors |
| **Vitest** | MIT | Anthony Fu and Vitest contributors |
| **TypeScript** | Apache 2.0 | Microsoft Corporation |

---

## Summary

All third-party software and model assets integrated into RYPER AI OS are licensed under permissive open-source terms (MIT, Apache 2.0, BSD-3-Clause, ISC). RYPER respects upstream creators and licenses, and complies with all redistribution and attribution requirements.
