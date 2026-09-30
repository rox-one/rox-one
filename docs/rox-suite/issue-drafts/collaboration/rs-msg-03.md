# RS-MSG-03 — Contacts: каталог, профиль и общая CRM identity

Contacts directory/profile объединить с CRM Contact/Company и сохранить Dossier как representation. Auth Principal, external Contact и emailaddress различаются; только verified binding связывает их. Imported contact не получает login/membership/grants.

## Current source evidence

Repository rox-one/rox-one; source SHA 249b3b44220bcfbd7d467de9cfc18f76e1c37807. Код — source of truth; screenshot не доказывает backend/API.

- [apps/electron/src/renderer/pages/extra-screens/dossier/DossierPage.tsx::DossierPage/save/updateEntity/addEntity](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/pages/extra-screens/dossier/DossierPage.tsx#L94-L189) — Local workspace JSON person/company cards и source aggregation; canonical shared CRM ACL не доказаны.
- [apps/electron/src/renderer/pages/extra-screens/dossier/dossier-model.ts::DossierKind / DossierEntity](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/pages/extra-screens/dossier/dossier-model.ts#L8-L34) — name/org/aliases/notes/promises; Principal binding и provider aliases — новые требования.
- [packages/core/src/rox2/platform-contract.ts::Rox2EntityRef / formatRox2EntityId](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/rox2/platform-contract.ts#L218-L240) — workspaceId/entityId/revisionId/accountNamespace сохраняются как общая identity.
- [packages/core/src/rox2/platform-contract.ts::ROX2_ENTITY_KINDS](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/rox2/platform-contract.ts#L17-L40) — note/page/channel/channel-message/person — существующие kinds, не доказательство backend полноты.

Contacts discoverability из референса2 — navigation pattern; screenshot не подтверждает CRM/enrichment/auth implementation.

## Экран, navigation и размеры

Messenger contextual Contacts и CRM directory показывают один ContactRef. List300–360px; profile flexible(min420), header56/avatar48/actions32, tabs36 «Обзор / Компания / История / Задачи / Документы». Row56 показывает company/role/source badge; contact fields policy filtered. Narrow Back restores selection. Existing routes.view.screen('dossier',id) aliases сохраняются; canonical Contact route proposed with parser/builder/migration.

## Controls и interactions

| Control / RU label | Input → Output | Hover / focus / help | Click / keyboard / failure |
|---|---|---|---|
| search · «Найти контакт» | query/company/tag/scope/cursor → permitted Contacts | Identity/provenance/asOf; hidden totals absent | / search/arrows/Enter; error ≠ empty |
| profile · «Профиль» | ContactRef/policy → allowed fields/CompanyRefs | Field source «Вручную / Почта / Импорт» + freshness | Open same ref; private email/phone omitted |
| message · «Написать» | verified Principal binding → same ensureDm | External Contact may have no ROX principal | Disabled «Нет ROX-профиля»; no fabricated user |
| company · «Связать с компанией» | Contact/Company/currentrev → relation receipt | Domain/email candidates explain confidence/source | Preview/confirm; two same names keep IDs; no implied grant |
| merge · «Объединить карточки» | reviewed aliases/accounts/source revisions → audit mapping | Relationships/undo/provenance impact | Explicit confirm; ambiguous accounts quarantine |
| context · «История взаимодействий» | linked permitted refs → email/chat/task/call/doc tiles | Source/current ACL/freshness; denied no title | Open each via gateway; agent context same constraints |

## Domain / API / storage / realtime / events / ACL

Provider-neutral Contact with addresses/Company links/origin/aliases/field provenance/hidden; Principal UUID/authsubject separate. EntityAlias scoped(workspace,provider,account,type,remoteId), not Contacts UI store. Dossier migration audited aliases/batch, never name-only identity. Commands target crm.createContact/updateContact/linkCompany/mergeContacts only after schemas; verified Principal mapping distinct admin capability. SQL contacts/company-links/alias/provenance history + common outbox, local Dossier standalone/import adapter retained. Contact created from email is external business entity only. Events contactcreated/updated/merged and link changes feed common search/activity/memory. Notify explicit assignment/mention/share, not every profile read. Agents gateway read/search/create/update/link with field/source policy; enrichment proposals retain citation/review.

## Точные изменения файлов

- Extend DossierPage/dossier-model import and typed-link ports; preserve notes/promises/brief sources.
- New proposed components/contacts/{ContactDirectory,ContactProfile,ContactMergeReview}.tsx; route host allocated once with suite CRM/Messenger owner.
- Reuse shared CRM contracts and Rox2 person/company bindings, no second Contacts DB.
- Proposed tests/rox-suite/contact-identity.test.ts and contact-profile.spec.ts.

## Пользовательский flow

External email → Contact candidate → company/domain review → Contacts/CRM open sameRef → Write disabled absent Principal → Task/Doc links show only permitted source context.

## Tests / Definition of Done

- [ ] Same Contact from Messenger/CRM/Company/mail/task retains ref after reload.
- [ ] Same-name different-account contacts/companies remain distinct; merge undo preserves provenance/aliases.
- [ ] External Contact cannot login or join DM without verified Principal binding.
- [ ] Denied mail subject/body/count not exposed in profile/search/agent.
- [ ] Concurrent field update CAS; source revoke purges cached projections.
- [ ] Seed name-only merge/contact-as-principal caught by identity/auth assertions.

## Dependencies / related / complexity

Draft dependencies: RS-MSG-01, RS-MSG-02.

- [#381](https://github.com/rox-one/rox-one/issues/381) — Target account+remoteType+remoteId; displayName не unique identity.
- [#380](https://github.com/rox-one/rox-one/issues/380) — Actions писать/отправлять требуют подтверждённого adapter и recipient policy.

Complexity: XL: identity/provenance migration and source-field ACL dominate UI. Main risks bad merge and accidental mail sharing.

## Общие quality gates

Draft specification; implementation/runtime **NOT_RUN**. Geometry — proposed ROX layout, не pixel measurements screenshot. RU i18n labels; current semantic fonts/theme/accent; light fixture + dark regression. Hitbox≥32px desktop/44px touch; visible focus, reduced-motion, readable contrast, Escape focus return. Tooltip и help доступны hover/focus/click; каждый metric объясняет definition/source/freshness/example. Hover не выполняет send/share/read mutation.

Feature включает model, persistence, commands/queries, permissions, realtime где нужно, search, mentions, attention/activity, agent tools, failures и observable receipt. Actor поступает из authenticated transport. Local saved/queued/committed/provider-confirmed различаются. Cached private preview после revoke очищается по policy; нельзя обещать физическое стирание disconnected device.

Acceptance evidence: exact commit/inputSha, domain receipt/ref/revision/hash, reload/concurrency/negative assertions, screenshots/ARIA/computed font/viewport/locale. Linux fixture UI, live service, Electron native и provider read-back — отдельные gates. Seeded assertion failure должен быть пойман; timeout/infra error не считается sensitivity. Literal Macro/Lark code/assets и приватные screenshot names/IDs/images не копировать.
