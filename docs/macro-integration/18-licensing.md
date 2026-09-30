# Licensing и происхождение кода

Аудит файлов и истории, не юридическое разрешение на перенос. Macro `c966b79d40798c6c726a3b15fe90517941fc6e61`, ROX `f63294ba4fffa7238b46b24e918925a313ad0b12`. `plans/macro-integration/license-inventory.json` содержит найденные tracked LICENSE/NOTICE/THIRD_PARTY файлы с hashes и manifest declarations.

## Проверенные факты

| Scope | Evidence | Наблюдение | Transfer classification |
|---|---|---|---|
| Macro root | `LICENSE.txt` 1–3; history commit `57a6c390927c774576d51d9e4fa94daeb04d5d32` | GNU AGPL version 3; commit заменил Business Source License | LICENSE_REVIEW_REQUIRED для literal source/service; BEHAVIOR_REIMPLEMENTATION по умолчанию |
| Macro web | `apps/web/LICENSE` 1; `9169593158e48e53af453cf0faf79121c8996027` move history | Copyright 2023 CoParse, Inc. All rights reserved; конфликт/неясность scope относительно root | LICENSE_REVIEW_REQUIRED; не трактовать root как отмену package notice |
| docs template | `apps/docs/LICENSE` 1–9 | MIT Mintlify | COPY_ALLOWED / ADAPT_ALLOWED только для покрываемого template, не всех product assets |
| filesystem vendored subtree | `apps/web/src/lib/filesystem/LICENSE` 1–9 | MIT Chris Hager | ADAPT_ALLOWED с attribution и конкретным source origin review |
| OpenSearch builder | `crates/opensearch_query_builder/LICENSE` 1–9 | MIT William Hutchinson | ADAPT_ALLOWED для доказанно покрытого crate; не blanket разрешение остальных crates |
| Loro mirror | `packages/loro-mirror/package.json` 43; `THIRD_PARTY_LICENSES.md` | manifest MIT; third-party Loro notices | LICENSE_REVIEW_REQUIRED до scope/history audit, затем возможен ADAPT_ALLOWED; предпочтительно DEPENDENCY_ONLY upstream |
| WebSocket imported code | `packages/collaboration/src/websocket/THIRD_PARTY_LICENSES.md` | MIT third-party attribution, не лицензия всего collaboration package | DEPENDENCY_ONLY upstream / file-scoped review |
| Lexical decorator | `packages/lexical-core/nodes/DecoratorBlockNode.ts` header | Meta copyright retained | DEPENDENCY_ONLY upstream Lexical; verify MIT provenance exact file before copy |
| ROX root | `LICENSE` 1–2; `NOTICE` 1–40 | Apache 2.0 Craft lineage, commercial SDK notice, Tencent MIT adapters | KEEP_ROX; preserve notices, verify dependencies separately |

AGPL §13 требует source availability при определённых modified network uses; Apache §4 описывает distribution notices. Анализ применимости к combined work/deployment требуется перед буквальным переносом. Primary texts: [GNU AGPL](https://www.gnu.org/licenses/agpl-3.0.html), [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0). Нельзя объявлять ROX proprietary/Apache-compatible только потому, что Macro service запускается отдельно: юридическая граница не автоматически совпадает с process boundary.

## Политика этого плана

Исследуются behavior/domain contracts; Macro implementation source не переносится. React UI и native ROX domain code пишутся самостоятельно. `PORT_DOMAIN` в matrix означает перенос семантики, не copy-paste. `PORT_SERVICE` может быть только license-reviewed deployment/adaptation после source/distribution obligations; default work packages используют REIMPLEMENT / DEPENDENCY_ONLY. Код Loro/LiveKit/Lexical устанавливается из независимых upstream packages с проверкой exact resolved licenses; наличие этих dependencies в Macro не переносит Macro license на independently-used upstream package автоматически.

## Dependency и provenance audit gates

1. Зафиксировать lockfile versions + resolved package integrity и SBOM для exact deploy artifacts: web/Electron, workspace service, sync, media, transcriber, ffmpeg.
2. Прочитать upstream license каждого dependency/artifact, включая codec/build flags, LiveKit plugins (Krisp), Deepgram SDK/model commercial terms и Claude SDK commercial notice. Cargo.lock/Bun lock не содержат исчерпывающую юридическую атрибуцию.
3. File-scoped origin history: `git log --follow`, imported/copied paths, copyright headers, patches/vendor notices. Отсутствие каталога third_party не доказывает отсутствие imported code; пример websocket attribution подтверждает это.
4. Release manifest должен содержать component→license→origin SHA→modifications→notices→decision reviewer. Неизвестный scope blocks literal copying; independent behavior implementation continues.
5. Требования product parity не отменяют лицензии. Выбор: dual-license permission, AGPL-compliant fork deployment с review, либо собственная реализация.

Аудит manifest declarations не равен complete dependency clearance. В этом задании зафиксирована карта рисков и gates; юридически спорные области остаются open question L1 в 23. В кодовых work packages нет скрытой зависимости от разрешения на literal Macro code copy.

## Lock-pinned dependency metadata

`dependency-license-report.json` перечисляет 3 330 resolved dependency records: 1 247 внешних Cargo.lock записей и 2 083 Bun lock artifacts. Проверены 13 exact-version primary registry records: Loro Rust 1.16.2 / JS 1.16.3 — MIT; LiveKit API 0.4.24 / protocol 0.7.7 / JS 2.21.0 — Apache-2.0; Lexical 0.45.0 — MIT; остальные license expressions сохранены без интерпретации в JSON. Источники: `crates.io/api/v1/crates/<name>/<version>` и `registry.npmjs.org/<name>/<version>`, URL и дата probe у каждой записи.

Это metadata verification, а не file/build clearance. Непроверенные transitive dependencies явно LICENSE_REVIEW_REQUIRED. В `bun.lock` PDF.js является fork `macro-inc/pdf.js#f9b2ce6`, поэтому upstream Apache/MIT предположение не закрывает его provenance. Actual ffmpeg binary build flags/codec/model assets также отдельные artifacts; SBOM release gate WP-48 закрывает exact deployed build. Literal source copy разрешается только по file-scoped decision, не по этой сводке.
