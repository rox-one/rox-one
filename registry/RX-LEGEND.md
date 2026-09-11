# RX Identifier Legend

> This file is the **only** English-first document in the Russian-default tree.
> The identifier scheme, its domain codes and status keys are English by design so
> they stay greppable, sortable and stable across tooling. Everything else in this
> repository — prose, comments, READMEs, task titles, tags — is Russian.
> See `docs/ru/README.md` for the Russian entry point.

## 1. Identifier grammar

```
RX-<DOMAIN>-<NNNN>[.<SUB>]

RX        fixed namespace prefix (ROX One)
DOMAIN    three-letter uppercase domain code, table below
NNNN      zero-padded sequential number, 0001..9999, unique per domain
SUB       optional zero-padded child number, 01..99, for sub-sections
```

Examples: `RX-TSK-0007`, `RX-ADR-0002`, `RX-DOC-0004.03`, `RX-SEC-0011`.

Regex (canonical, used by `scripts/rx-validate.ts`):

```
\bRX-(TSK|EPC|FEA|CMP|PKG|SRF|INT|PLG|AUT|PIP|AST|ADR|SPC|DOC|SES|SEC|RSK|API|DAT)-\d{4}(\.\d{2})?\b
```

## 2. Domain codes

| Code  | English legend               | Русское значение                  | Numbering authority        |
|-------|------------------------------|-----------------------------------|----------------------------|
| `TSK` | Task                         | Задача                            | `docs/ru/RX-DOC-0002-tasks.md` |
| `EPC` | Epic                         | Эпик (группа задач)               | tasks document             |
| `FEA` | Feature                      | Функция продукта                  | audit document             |
| `CMP` | Component                    | Компонент / блок UI или логики    | registry                   |
| `PKG` | Package                      | Пакет workspace                   | registry                   |
| `SRF` | Surface                      | Поверхность (экран, панель, рельс)| registry                   |
| `INT` | Integration                  | Интеграция с внешней системой     | registry                   |
| `PLG` | Plugin / Add-on              | Плагин, аддон, расширение         | registry                   |
| `AUT` | Automation                   | Автоматизация, скрипт, воркфлоу   | registry                   |
| `PIP` | Pipeline                     | Пайплайн CI/CD, сборка            | registry                   |
| `AST` | Asset                        | Ассет (шрифт, лого, плашка)       | registry                   |
| `ADR` | Architecture Decision Record | Архитектурное решение             | `docs/architecture`        |
| `SPC` | Specification                | Спецификация                      | `docs/specs`               |
| `DOC` | Document section             | Раздел или подраздел документации | `docs/ru`                  |
| `SES` | Session                      | Рабочая сессия агента             | tasks document             |
| `SEC` | Security finding             | Находка по безопасности           | `docs/ru/RX-DOC-0004-security.md` |
| `RSK` | Risk                         | Риск (не-security)                | tasks document             |
| `API` | API contract                 | Контракт API                      | registry                   |
| `DAT` | Data model                   | Модель данных                     | registry                   |

`Блок` maps to `CMP`; `подраздел` maps to `DOC` with a `.SUB` suffix.

## 3. Status keys

Keys are English, display labels are Russian.

| Key          | Русская метка   | Meaning                                             |
|--------------|-----------------|-----------------------------------------------------|
| `planned`    | Запланировано   | Accepted into scope, not started.                    |
| `active`     | В работе        | Someone or some agent is executing it now.           |
| `blocked`    | Заблокировано   | Cannot progress; `blocker` field must be filled.     |
| `done`       | Готово          | Merged and verified by a gate.                       |
| `dropped`    | Отменено        | Consciously abandoned; `reason` field must be filled.|

## 4. Registry

`registry/rx-registry.yaml` is the single machine-readable source of truth.
Every entry:

```yaml
- id: RX-PKG-0001          # required, unique, matches the grammar above
  title: Ядро платформы     # required, Russian
  kind: package             # required, lowercase English domain word
  path: packages/core       # optional, repo-relative
  status: done              # required, one of the status keys
  owner: rox-core           # optional
  refs: [RX-ADR-0002]       # optional, other RX ids
  note: |                   # optional, Russian
    Свободное описание.
```

## 5. Where identifiers must appear

1. **Registry** — every catalogued entity, no exceptions.
2. **Markdown front matter** — `rx-id: RX-DOC-0004` in Russian documents.
3. **Filenames** in `docs/ru/` — `RX-DOC-0004-security.md`. The slug after the id is
   a Latin ASCII slug so the paths stay portable across Linux CI and macOS;
   the human-readable Russian title lives in the `# ` heading. This is deliberate,
   recorded as `RX-ADR-0101`.
4. **Commit messages** — `feat(ru): ... (RX-TSK-0012)` when a task is advanced.
5. **Source code** — a `// RX-CMP-0031` marker line above an exported component,
   only where it is genuinely load-bearing for navigation. Do not spray markers.

## 6. Allocation rules

- Numbers are allocated **sequentially and never reused**, even after `dropped`.
- Allocation happens by appending to `registry/rx-registry.yaml`; the validator
  rejects duplicates and gaps are allowed.
- Renaming an entity keeps its identifier. The identifier is the stable handle.

## 7. Enforcement

`bun run rx:validate` checks: grammar, uniqueness, status vocabulary, dangling
`refs`, and that every file under `docs/ru/` carries a matching `rx-id`.
The check runs in CI as `RX-PIP-0003`.
