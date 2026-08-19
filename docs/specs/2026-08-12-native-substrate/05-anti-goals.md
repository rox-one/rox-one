# N-05. Anti-goals

- **Doc ID**: N-05
- **Статус**: draft
- **Дата**: 2026-08-13

Не делать в native-срезе:

- Переписывать `SessionManager.ts` на Rust.
- Второй RPC/codec (protobuf, capnproto) до профилирования.
- `craft-exec` / Zig `sandbox-spawn` до host-tool Bash.
- `craft-icn` / llama.cpp / ggml в дереве.
- Kotlin Multiplatform вместо Swift CraftAgentKit.
- Java desktop / Spring.
- Класть `craft-native` в Electron `extraResources`.
- Обещать Windows x64 в пользовательских docs.
- Поглощать episodic embeddings и knowledge watcher в `craft-index`.
- Считать модуль готовым потому что `cargo build` зелёный.
