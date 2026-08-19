# N-00. Native substrate — обзор

- **Doc ID**: N-00
- **Статус**: draft
- **Дата**: 2026-08-13
- **Связанные документы**: [README](./README.md), [N-01](./01-adrs.md)

## Цель

Поставить под TypeScript control plane одно компактное Rust-ядро (`craft-native`) без полиглотного rewrite. Первый vertical slice — индексация локальных source folders.

## Формула

```
TypeScript = что система делает и почему
Rust       = как она надёжно индексирует и хранит hot-path состояние
Zig        = не в v1
Swift      = Apple-клиент (уже CraftAgentKit); не runtime
Kotlin     = только вместе с Android-клиентом (его нет)
Java       = нигде в runtime
```

## Процессная граница

```
Electron / headless server
        │  length-prefixed JSON MessageEnvelope
        │  Unix socket (named pipe — когда появится Windows runner)
        ▼
   craft-native
        ├── native:health | version | capabilities
        ├── index:reindex | search | retrieve | count | status
        ├── run:create | status | cancel | listArtifacts | fetchArtifact | events
        └── journal:write | read | status
```

Падение sidecar не роняет Electron: супервизор отключает native после N рестартов, TS-путь остаётся primary.

## Канон контрактов

Проводные DTO: `packages/shared/src/protocol/{types,channels,dto,events}.ts`.
Не `packages/core` (там persistence-типы).

## Доставка бинарника

Toolchain download manager (`~/.craft-agent/toolchain/...`), как omp/ffmpeg. Не `extraResources` (нотаризация). Пока артефакты не публикуются — `CRAFT_NATIVE_BIN` или `native/target/debug/craft-native`.
