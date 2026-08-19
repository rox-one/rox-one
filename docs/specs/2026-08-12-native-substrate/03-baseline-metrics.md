# N-03. Baseline metrics

- **Doc ID**: N-03
- **Статус**: draft
- **Дата**: 2026-08-13
- **Стенд**: Linux x64, bun 1.3.14, Node 22.14.0, tmpdir на tmpfs
- **Harness**: `bun scripts/bench/index-bench.ts`

JSON поля: `filesPerSec`, `searchMs`, `ftsAvailable`, `indexed`, `truncated`.

Снято **до** включения Rust index как primary. Сырой `bench-results/` не коммитится (`.gitignore`).

## bun — source index (FTS5)

`ftsAvailable: true`. Потолок `MAX_FILES = 2000` режет деревья 5k и 20k (`truncated: true`). `MAX_TOTAL_BYTES = 32MB` на этом синтетическом дереве (~250 B/файл) не срабатывает.

| requestedFiles | walked | truncated | indexed | fts | walkMs | indexMs | searchMs | filesPerSec | searchHits |
|---|---:|---|---:|---|---:|---:|---:|---:|---:|
| 1000 | 1000 | false | 1000 | true | 8.19 | 33.88 | 1.85 | 122054 | 10 |
| 5000 | 2000 | true | 2000 | true | 14.63 | 55.66 | 1.37 | 136684 | 10 |
| 20000 | 2000 | true | 2000 | true | 14.85 | 80.65 | 1.31 | 134725 | 10 |

`filesPerSec` считается по walk, не по SQLite upsert. Index+FTS на 2000 файлов ≈ 34–81 ms. Search p99-класса на этом стенде < 2 ms.

## node / Electron — bun:sqlite miss

Полный `index-bench.ts` под node **не** гоняется: ESM не резолвит extensionless `./source-index` из facade. Это ограничение harness, не метрика поиска.

Характеризация драйвера: `node scripts/bench/node-sqlite-probe.cjs` → exit 2, `bunSqlite: false`, `code: MODULE_NOT_FOUND`. Тот же факт уже в `source-index.test.ts` (`require('bun:sqlite')` → status 2). Пустой FTS в Electron — отсутствие `bun:sqlite`, не «JS медленный».

## Прочие harness

| Harness | Результат |
|---|---|
| `scripts/bench/journal-bench.ts` | 10_000 JSONL append за 20.32 ms → **492137 events/sec** |
| `scripts/bench/rpc-bench.ts` | n=200 echo, **p50 0.020 ms**, **p95 0.058 ms**, max 3.86 ms |
| `scripts/bench/runner-recovery-bench.ts` | SIGKILL pid → `state: failed`, `failureReason: runner_error`, **reconcileMs 1.22** |

## Как читать

- bun walk/index на tmpfs уже быстрый; Rust оправдывается **снятием 2000/32MB**, incremental/watcher и выносом sync walk с event loop, не микросекундами FTS на 2k файлах.
- RPC round-trip << LLM latency; транспортный rewrite не в этом срезе.
- Crash-reconcile на local provider уже работает (см. U4).

## Ворота для flip Rust → primary

- ≥3× files/sec против bun full walk на 5k файлах **или** снятие truncate на 20k при том же качестве hits.
- Нет sync walk на server event loop (sidecar process).
- Shadow diffs по path-set = 0 на фикстурах `source-index.test.ts`.

**Implemented (opt-in):** `craft-index` `MAX_FILES = 20_000`, `MAX_TOTAL_BYTES = 256MB`. Enable with `CRAFT_FEATURE_NATIVE_SIDECAR=1` + `CRAFT_FEATURE_NATIVE_INDEX_PRIMARY=1`. Facade awaits sidecar `index:*` and falls back to TS (still 2000/32MB) on failure. RPC transport unchanged (N-03: p50 0.020 ms).
