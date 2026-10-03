# RS-DRV-01 — Docs / Drive: единая библиотека Recent, Owned, Shared, Favorites и table/grid

Развить PagesHome в Docs/Drive workspace library по референсу5: Docs rail Home/Drive/Wiki/pinned/my library, header New/Upload/Templates, Recent/Owned/Shared/Favorites, filters/display/table-grid. Row references canonical Page/Note/File, не новую document copy. Existing Page artifacts и personal Notes сохраняются.

## Current source evidence

Repository rox-one/rox-one; source SHA 249b3b44220bcfbd7d467de9cfc18f76e1c37807. Код — source of truth; screenshot не доказывает backend/API.

- [apps/electron/src/renderer/components/pages/PagesHome.tsx::PagesHome/visiblePages/openPage/handleCreatePage](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/components/pages/PagesHome.tsx#L25-L105) — Pages grid фильтрует Project ID, сортирует updatedAt, создаёт interactive artifact.
- [packages/core/src/types/page.ts::PageConfig](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/types/page.ts#L294-L320) — Stable id/slug/projectId, runtime kind, digest-bound grants/refresh/share существуют.
- [apps/electron/src/renderer/components/pages/PageView.tsx::PageView/PageFrame](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/components/pages/PageView.tsx#L386-L439) — Сохраняется artifact runtime с lease/snapshot/error states.
- [apps/electron/src/renderer/components/right-sidebar/SessionFilesSection.tsx::SessionFilesSection](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/components/right-sidebar/SessionFilesSection.tsx#L423-L459) — Session folder tree/expanded state; workspace Drive ACL/index не установлены.
- [packages/shared/src/projects/types.ts::ProjectConfig / ProjectAsset](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/shared/src/projects/types.ts#L35-L66) — Project stable id/details/cwd и assets semantics сохраняются.
- [packages/core/src/rox2/platform-contract.ts::Rox2EntityRef / formatRox2EntityId](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/rox2/platform-contract.ts#L218-L240) — workspaceId/entityId/revisionId/accountNamespace сохраняются как общая identity.
- [packages/ui/src/styles/index.css::font-ui-narrow/font-sans/font-mono/font-chat](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/ui/src/styles/index.css#L121-L129) — Наследовать selected semantic fonts/theme, не навязывать второй global font.

Референс5 просмотрен: Docs search/Home/Drive/Wiki/pinned tree; New/Upload/Templates; tabs/filter/display/list-grid; Name/Location/Owner/Created/Recent. Приватные titles/owners/dates/assets отсутствуют в issue.

## Экран, navigation и размеры

Global shell same; Docs rail220px, main library min560; header56, action tiles min140×64, tab/filter40, table rows44/header36. Nameflex(min240), Location180, Owner140, Created140, Recent160, overflow32; grid min220×160/gap12–16. <960 rail collapses, <720 rows/cards remain keyboard usable. Pages destination may receive Docs displaylabel/typed alias through suite owner; no second Pages store. Existing pages/page/{slug} survives. Folder/path alias mapping explicit.

## Controls и interactions

| Control / RU label | Input → Output | Hover / focus / help | Click / keyboard / failure |
|---|---|---|---|
| tabs · «Недавние / Мои / Общие / Избранное» | actor/workspace/scope/cursor → same permitted refs | Recent=lastOpenedAt; Created/Updated distinct clocks | Arrows/Enter; paged sorting; personal favorite ≠ team pin |
| new · «Создать» | Document/Artifact/type/project/folder → canonical ref receipt | Editable Doc vs HTML Page/capability explanation | Keyboard menu/title required; idem create then navigate |
| upload · «Загрузить» | bytes/chunks/checksum/container/limits → progress/scanning/ready FileRef | Size/type/audience/source; pending not ready | Drop/picker; failed parts same uploadId; preserve partial errors |
| templates · «Шаблоны» | approved template/version/origin → preview/new Doc | License/source/version; no personal content implied | Explicit preview/apply; template provenance retained |
| row · «Открыть» | EntityRef/representation/ACL → canonical detail | Type/owner/location/clocks; focus overflow | Enter opens/ShiftF10 menu; sorting aria announcement |
| display · «Фильтр / Вид» | types/owner/location/sort/columns/view → personal view | Meaning/source/asOf/authorised count | Popover Escape; table/grid same ID set |
| pin/star · «Закрепить / В избранное» | ref/pincontainer or actorfavorite → preference receipt | Pin/team role vs personalstar; no grant change | Optimistic rollback; revoked private pin title disappears |
| move/trash · «Переместить / В корзину» | refs,targetcontainer,revision/impact → receipt/tombstones | Audience/public copy retention preview | Explicit scope confirm; denied partial results, not silent bulk success |

## Domain / API / storage / realtime / events / ACL

library.list over canonical registry with scope/type/folder/owner/sort/cursor. lastOpenedAt per-actor preference distinct updatedAt. DriveFolder/collection stores ordered membership refs, no copies of bodies/blobs; new container identity needs registry/schema/migration before dispatch. Common file.beginUpload/finalize/download and existing Pages adapters. Local path mutable alias, digest checksum not global ID. SQL registry/File/object metadata/collections/preferences + S3-compatible storage abstraction. Events entity/link/collection/preference changes via common outbox; extractors/search/mentions/agents ACL scoped. SharedWithMe effective grants; moving private into shared folder requires reviewed audience impact, not auto-share. Notify explicit share/mention only; archive/trash/physicaldelete/publication retention distinct.

## Точные изменения файлов

- Extend PagesHome/PagesView dispatch and preserved PageView/SharePageDialog.
- Proposed components/drive/{DriveLibrary,DriveRail,DriveTable,LibraryViewSettings,LibraryImportReview}.tsx reuse common File/entity list.
- Adapt ProjectAsset/SessionFiles projection with stable aliases and verified native permissions, no arbitrary session-folder mutation.
- Proposed tests/rox-suite/library-index.test.ts and drive-library.spec.ts.

## Пользовательский flow

Create Doc → Owned/Recent → share B → B Shared → favorite → same row opens Docs → folder move audience review → reload table/grid sameIDs/filter.

## Tests / Definition of Done

- [ ] Recent/Owned/Shared/Favorites correct ACL sets; clocks separate, table/grid same IDs.
- [ ] New Doc/artifact/upload each routes correct renderer; #570 grants/refresh/public-copy behavior retained.
- [ ] File checksum/scanning/malware/error/reload-resume with stable FileRef.
- [ ] Private folder move cannot leak title/body through facets/shared list.
- [ ] Partial trash/revoke/retention outputs honest; preference rollback/reload consistent.
- [ ] Seed duplicate view entities, wrong timestamp and hidden facet totals caught.

## Dependencies / related / complexity

Draft dependencies: нет среди этих семи; common identity/ACL/command authority — обязательный foundation gate.

- [#570](https://github.com/rox-one/rox-one/issues/570) — Расширить Pages library/preview/grants с сохранением Project binding/artifact runtime.
- [#563](https://github.com/rox-one/rox-one/issues/563) — Native Notes не становятся shared автоматически; интеграция отдельный issue.

Complexity: XL: catalog projections, collection permissions, uploads/native aliases; deliver Page/File library then child Notes/Wiki.

## Общие quality gates

Draft specification; implementation/runtime **NOT_RUN**. Geometry — proposed ROX layout, не pixel measurements screenshot. RU i18n labels; current semantic fonts/theme/accent; light fixture + dark regression. Hitbox≥32px desktop/44px touch; visible focus, reduced-motion, readable contrast, Escape focus return. Tooltip и help доступны hover/focus/click; каждый metric объясняет definition/source/freshness/example. Hover не выполняет send/share/read mutation.

Feature включает model, persistence, commands/queries, permissions, realtime где нужно, search, mentions, attention/activity, agent tools, failures и observable receipt. Actor поступает из authenticated transport. Local saved/queued/committed/provider-confirmed различаются. Cached private preview после revoke очищается по policy; нельзя обещать физическое стирание disconnected device.

Acceptance evidence: exact commit/inputSha, domain receipt/ref/revision/hash, reload/concurrency/negative assertions, screenshots/ARIA/computed font/viewport/locale. Linux fixture UI, live service, Electron native и provider read-back — отдельные gates. Seeded assertion failure должен быть пойман; timeout/infra error не считается sensitivity. Literal Macro/Lark code/assets и приватные screenshot names/IDs/images не копировать.
