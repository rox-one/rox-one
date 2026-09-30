# Revision 4 — формы CRM, Mail, Calendar и Calls

Статус: **PROPOSED / NOT_IMPLEMENTED**. UI/native/provider/product E2E **NOT_RUN**. Уточнение существующих screen/control IDs; proposed secondary registrations на одном existing authenticated gateway, без параллельных entity stores или ACL.

ROX code baseline f63294ba4fffa7238b46b24e918925a313ad0b12; artifact read baseline 249b3b44220bcfbd7d467de9cfc18f76e1c37807. Source evidence отделён от normative target. Macro code не копировался.

## Общие правила

- **reference:** Rox2EntityRef{workspaceId,entityId,revisionId?,accountNamespace?}; no raw names/email as IDs. Shared UI form EntityRef resolves to this canonical contract.
- **envelope:** RoxCommand{workspaceId,commandId,idempotencyKey,expectedRevision?,policyRevision?}; actor injected by authenticated transport, no renderer actor. FormbaseRevision mapped viaauthority compatible tokenadapter, never arbitrary numericcast.
- **status:** executionMode live|fixture|simulated; lifecycle queued|running|waiting_approval|succeeded|failed|cancelled|unknown; verification unverified|receipt_verified|readback_verified. DomainoperationState separate. Receipt/queryresult success doesnotprove product/providerlane.
- **draftRule:** Hydrate baseline once per aggregate revision; keep raw invalid text separately. Never overwrite dirtyform with background read; banner+compare. Dirty clears only if ack snapshot hash equals current edited snapshot. Sameintent retry samepayload/key; changedpayload newintent/key after prior outcome resolved.
- **microcopyRule:** Form-specific messages below plus explicit field error aria-describedby+rolealert; loading aria-busy, submit repeat locked. No public/provider-success badge fromfixture.
- **helpRule:** Current typography/token inheritance; hover500ms, keyboardfocus and separate «Что это?» click show meaning/units/source/asOf/example; reducedmotion. No new globalfont claim.
- **validationLimits:** Limits marked PROPOSED are normative target proposals; assigned WP schema/test must adopt same values before UI dispatch. Versioned servercapability is source for dynamic limits; stricterproviderlimit displayed.
- **unknownFields:** All wire mutation schemas additionalProperties=false; target extensions explicitly listed. Unrecognizedoperation/field disabled+error before dispatch, never silent stripping causing apparent success.
- **validationBoundary:** Tests below are acceptance examples, not executed E2E. Artifact validator only checks references/ownership/schema consistency, not provider/device behavior.
- **MoneyTarget:** Normative Revision4 transport/Postgres BIGINT mapping Money{amountMinor:decimal_integer_string,currency:ISO4217}|null; old minorUnits integer remains historical. No Number/IEEE754 coercion; bounded exactstring/BigInt parsing/serialization.
- **fixtureStatus:** Machine payload fixtures validate targetshape separately from semantic/provider/UI examples. All product runtime scenarios NOT_RUN.

## Реестр

| ID | Форма | Screen / controls | WP |
|---|---|---|---|
| DF-01 | Ответственный за компанию | CRM-03: owner-edit | WP-24 |
| DF-02 | Выручка компании — точная денежная сумма | CRM-03: revenue-edit | WP-24 |
| DF-03 | Контакт — связь с компанией и provenance | CRM-04: company-link, email | WP-22, WP-23, WP-19 |
| DF-04 | Письмо — черновик, получатели, вложения, отправка | MAIL-03: draft, send, attach | WP-19, WP-17 |
| DF-05 | Запланированная отправка и отмена гонки | MAIL-04: schedule, cancel | WP-21, WP-19 |
| DF-06 | Неоднозначная отправка — проверка результата | MAIL-04: reconcile | WP-21, WP-19 |
| DF-07 | Событие Calendar — редактор полей и provider echo | CAL-02: save | WP-28 |
| DF-08 | RSVP — ответ своего аккаунта | CAL-02: rsvp | WP-28 |
| DF-09 | Повторяющееся событие — scope и DST | CAL-02: series, save | WP-29, WP-28 |
| DF-10 | Присоединение к звонку — устройства и auth | MTG-05: join | WP-31, WP-32 |
| DF-11 | Согласие на запись — точная привязка артефакта | MTG-06: grant, start, revoke | WP-33, WP-35 |
| DF-12 | Архив звонка — повтор обработки конкретного артефакта | MTG-07: retry-artifact, play | WP-34, WP-33 |

## DF-01 — Ответственный за компанию

**Current / proposed:** Current Dossier has no normalized business owner. Proposed owner is company business property, never PermissionGrant owner.

**Layout:** Company header → «Ответственный» value → compact popover with authorized principal search, «Не назначен», «Сохранить». Company name/domain shown read-only context.

**Screen/controls:** CRM-03 / owner-edit. **WP:** WP-24. **Evidence:** R4-E01.

### Поля

| Field / RU label | Type / required | Default / source | Validation / coercion | Dirty / help |
|---|---|---|---|---|
| companyName · Компания | readonly string / required | "GetCompanyContext.company.name"<br>authorized current Company projection | Not user submitted; never use display name as identity<br>none | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Название из CRM; переименование не входит в этот control. |
| companyRef · Идентификатор компании [immutable hidden binding] | Rox2EntityRef / required | "current company canonical ref"<br>authenticated route/context | Same workspace, entity kind company, policy read/write<br>alias resolved by server; no name/email matching | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Изменяется одна canonical компания. |
| ownerRef · Ответственный | Rox2EntityRef  /  null / optional | "persisted ownerRef or null"<br>workspace principal picker; only authorized members | Principal kind user, active workspace member; no CRM Contact masquerading as user<br>Choose exact ref; clear→null; omitted field≠clear | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Ответственный ведёт работу с компанией. Это не выдаёт доступ. |
| baseRevision · Версия компании [immutable hidden binding] | opaque revision token / required | "hydrated revision"<br>GetCompanyContext | CAS; stale revision conflict<br>leaf baseRevision:number may map only via authority revision adapter; no parseInt opaque token | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Если компания изменилась, сравните значения перед сохранением. |

### Actions / typed contracts

#### Сохранить · crm.updateCompany

- Binding: WP-24.operations[crm.updateCompany]; CRM-03.SetCompanyOwner facade.
- Request schema: DF-01-SCHEMA-1.
- Input: Envelope(expectedRevision,idempotencyKey)+{company:Rox2EntityRef,ownerPrincipalId:string|null}.
- Result: {receiptId,companyRef,ownerRef:Rox2EntityRef|null,revision,status:CanonicalStatus,operationState:applied|queued}.
- Errors: denied, conflict, principal_not_workspace_member, invalid_principal_kind, not_found.
- Transition: Validate fields → focus first error → fresh capability/revision → one durable intent/key → lock same form action → receipt/readback; never label queued as completed.
- Mapping: ownerRef.entityId→authority-resolved ownerPrincipalId; null clears property. Add nullable ownerPrincipalId schema before UI dispatch. Actor injected, never sent.

### Request mapping / schema amendments

- WP24 primary ownerPrincipalId string currently forbids null; add null union and membership check, reject arbitrary account/Contact ref.
- One company repository/outbox; omitted owner retains existing value; explicit null removes it.

```json
{
  "status": "PROPOSED_NORMATIVE_TARGET_OVERRIDE",
  "fields": {
    "companyRef": "company",
    "ownerRef": "authority-resolve userref.entityId→ownerPrincipalId; null clears",
    "baseRevision": "envelope.expectedRevision tokenadapter"
  },
  "envelope": "workspaceId/commandId/idempotencyKey/expectedRevision separate; actor authenticatedserver",
  "rejectUnknownFields": true,
  "registrationBoundary": "Any named secondary canonical operation above is proposed registration in same authority before UI dispatch. Exact request schema and examples provided; original leaf symbol retained as adapter provenance."
}
```

- **DF-01-SCHEMA-1 / o:** REQUIRED_BEFORE_UI_DISPATCH. Exact Draft07 payloadSchema в JSON; additionalProperties=false. semanticConstraints требуют server validation. Historical Revision2 не считается доказанным target.

### Видимые состояния

- **disabled:** Нет права изменять компанию.
- **loading:** Сохраняем ответственного…
- **error:** Компания изменилась. Ваш выбор сохранён; проверьте новое значение.
- **success:** Ответственный сохранён.
- **offline:** Нет связи. Изменения сохранены в черновике; операция не подтверждена.
- **reload:** Восстановить сохранённый baseline, незавершённый intent и отдельно несохранённые поля; повторный dispatch только того же immutable intent.
- **dirtyClose:** Есть несохранённые изменения. «Продолжить редактирование» / «Сохранить черновик» / «Закрыть без сохранения». Отправленный intent закрытием не отменяется.

### Focus / keyboard / help

- **focus:** Open → principal search; error→owner picker; Escape cancel restores owner-edit trigger.
- **keyboard:** Typing/↑↓ browse, Enter chooses member; Cmd/Ctrl+Enter saves; do not send on IME composition or autocomplete Enter.
- **click:** Selecting member only edits draft, clear selects «Не назначен»; save dispatches once.

Field-specific help доступен hover500ms, focus и отдельной кнопкой «Что это?», показывает смысл/единицы/source/asOf/example; не меняет значение. Ошибка aria-describedby, first invalid focus; IME/autocomplete consumes Enter.

**Permissions / provider:** company.write; business owner does not grant read/share/edit. Provider-independent. Offline shared mutation unverified queued only if authorized replay policy allows.

### Owned implementation seams

- WP-24: apps/electron/src/renderer/pages/extra-screens/dossier/CompanyPropertyEditor.tsx — owner editor.
- WP-24: apps/electron/src/renderer/pages/extra-screens/dossier/DossierPage.tsx — DossierPage.

### Domain examples — NOT_RUN

1. **valid** {"company": "company:acme", "ownerRef": "user:anna", "baseRevision": "r7"} → One company revision r8; list/board/context/agent readback user:anna; ACL grants unchanged.
2. **negative** {"ownerRef": "contact:anna"} → invalid_principal_kind; no property change/event/notification/grant.

### Machine fixtures — NOT_RUN product runtime

```json
[
  {
    "id": "DF-01-F1",
    "kind": "valid_schema",
    "canonicalOperation": "crm.updateCompany",
    "schemaAmendmentId": "DF-01-SCHEMA-1",
    "payload": {
      "company": {
        "workspaceId": "ws:test",
        "entityId": "company:acme"
      },
      "ownerPrincipalId": "user:anna"
    },
    "envelope": {
      "workspaceId": "ws:test",
      "commandId": "DF-01-intent1",
      "idempotencyKey": "DF-01-key1",
      "expectedRevision": "r7"
    },
    "expected": "Shapevalid thenACL/provider/CASsemantic validation; NOT_RUN runtime."
  },
  {
    "id": "DF-01-F2",
    "kind": "negative_schema",
    "schemaAmendmentId": "DF-01-SCHEMA-1",
    "payload": {
      "company": {
        "workspaceId": "ws:test",
        "entityId": "company:acme"
      },
      "ownerPrincipalId": "user:anna",
      "unrecognizedMutationField": "reject"
    },
    "expectedError": "INVALID_PAYLOAD unknown field; no mutation/providercall."
  }
]
```

## DF-02 — Выручка компании — точная денежная сумма

**Current / proposed:** Current Dossier lacks typed money. Proposed revenue exact decimal minor-unit string, currency exponent policy; no binary float or implicit FX.

**Layout:** Company property «Выручка» → amount text field + currency select; explicit «Не указана» and «Сохранить». Read-only company identity retained.

**Screen/controls:** CRM-03 / revenue-edit. **WP:** WP-24. **Evidence:** R4-E01.

### Поля

| Field / RU label | Type / required | Default / source | Validation / coercion | Dirty / help |
|---|---|---|---|---|
| amountText · Сумма | string / optional | "format persisted amountMinor using selected currency exponent; null→empty"<br>Company.revenue | Unsigned digits with at most one comma OR dot decimal separator; group spaces/NBSP allowed only validated 3-digit grouping; no exponent, sign, NaN, currency symbols; excess precision rejected<br>Strip permitted grouping; comma→dot; exact string arithmetic; currencyExponent versioned table. Empty+explicit unset→null; 0→amountMinor:"0" | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Введите сумму в выбранной валюте. Пустое значение и ноль различаются. |
| currency · Валюта | ISO4217 code / required | "persisted currency; otherwise workspace configured currency; absent→no selection"<br>versioned supported currency list | Required only for nonempty amount; configured supported code; no arbitrary 3-letter fake code<br>Uppercase selection; changing currency preserves digits without FX, requires preview confirmation | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Валюта не конвертирует сумму. USD 12,34 =1234 цента; JPY дробная часть запрещена. |
| unset · Не указана | boolean / required | "persisted revenue is null"<br>current company | If true disable amount/currency and payload revenue=null; if false amount required incl zero<br>Explicit toggle; no silent blank→zero | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Удаляет значение выручки, но не компанию. |
| baseRevision · Версия компании [immutable hidden binding] | opaque revision token / required | "hydrated company revision"<br>authority | CAS<br>no lossy numeric coercion | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Изменения сравниваются по версии. |

### Actions / typed contracts

#### Сохранить · crm.updateCompany

- Binding: WP-24.operations[crm.updateCompany]; CRM-03.SetCompanyRevenue facade.
- Request schema: DF-02-SCHEMA-1.
- Input: Envelope+{company:Rox2EntityRef,revenue:{amountMinor:string,currency:string}|null}.
- Result: {receiptId,companyRef,revenue:Money|null,revision,status:CanonicalStatus}.
- Errors: denied, conflict, invalid_currency, invalid_minor_units, amount_out_of_range, not_found.
- Transition: Validate fields → focus first error → fresh capability/revision → one durable intent/key → lock same form action → receipt/readback; never label queued as completed.
- Mapping: Leaf value→primary revenue. Replace old primary Money.minorUnits integer with exact amountMinor decimal string; do not convert via Number. Null union explicit.

### Request mapping / schema amendments

- Existing machine $defs Money minorUnits:integer conflicts with leaf exact string. WP24 must normalize shared schema to amountMinor:string before form implementation.
- Normative proposed range:0..9223372036854775807 minor units inclusive; no negative revenue. Authority and UI same versioned currency exponents; compare integer strings/BigInt, not floats.

```json
{
  "status": "PROPOSED_NORMATIVE_TARGET_OVERRIDE",
  "fields": {
    "companyRef": "company",
    "amountText": "exact decimal parse currency exponent→revenue.amountMinor",
    "currency": "revenue.currency",
    "unset": "true→revenue:null; false→Money",
    "baseRevision": "envelope.expectedRevision"
  },
  "envelope": "workspaceId/commandId/idempotencyKey/expectedRevision separate; actor authenticatedserver",
  "rejectUnknownFields": true,
  "registrationBoundary": "Any named secondary canonical operation above is proposed registration in same authority before UI dispatch. Exact request schema and examples provided; original leaf symbol retained as adapter provenance."
}
```

- **DF-02-SCHEMA-1 / o:** REQUIRED_BEFORE_UI_DISPATCH. Exact Draft07 payloadSchema в JSON; additionalProperties=false. semanticConstraints требуют server validation. Historical Revision2 не считается доказанным target.
  - Semantic validation: {"storage": "Postgres BIGINT", "minAmountMinor": "0", "maxAmountMinor": "9223372036854775807", "coercion": "decimal string → BigInt only → decimal string; never Number", "nullMeans": "unset", "zeroMeans": "explicit zero", "currencyExponentSource": "versioned supported currency metadata"}

### Видимые состояния

- **disabled:** Укажите сумму и валюту либо выберите «Не указана».
- **loading:** Сохраняем выручку…
- **error:** В этой валюте допустимо другое число знаков после запятой.
- **success:** Выручка сохранена.
- **offline:** Нет связи. Изменения сохранены в черновике; операция не подтверждена.
- **reload:** Восстановить сохранённый baseline, незавершённый intent и отдельно несохранённые поля; повторный dispatch только того же immutable intent.
- **dirtyClose:** Есть несохранённые изменения. «Продолжить редактирование» / «Сохранить черновик» / «Закрыть без сохранения». Отправленный intent закрытием не отменяется.

### Focus / keyboard / help

- **focus:** Amount first; currency error→currency; range/precision→amount; preserve raw input on error.
- **keyboard:** Tab amount/currency/unset; Cmd/Ctrl+Enter save; Enter on currency selects only; Escape restores trigger.
- **click:** Currency change opens exact old/new amount preview, no conversion; help displays exponent/version/source.

Field-specific help доступен hover500ms, focus и отдельной кнопкой «Что это?», показывает смысл/единицы/source/asOf/example; не меняет значение. Ошибка aria-describedby, first invalid focus; IME/autocomplete consumes Enter.

**Permissions / provider:** company.write; hidden/denied company fails same authority; no mixed-currency sum without rate/source/asOf.

### Owned implementation seams

- WP-24: apps/electron/src/renderer/pages/extra-screens/dossier/CompanyPropertyEditor.tsx — money editor.

### Domain examples — NOT_RUN

1. **valid** {"amountText": "12 345,67", "currency": "USD", "unset": false} → {"amountMinor": "1234567", "currency": "USD"}
2. **valid** {"amountText": "0", "currency": "JPY", "unset": false} → {"amountMinor": "0", "currency": "JPY"}
3. **negative** {"amountText": "1.001", "currency": "USD"} → invalid_minor_units; no rounding/no write.
4. **valid_with_negative_control** {"amountText": "9007199254740993", "currency": "JPY"} → Persist exact9007199254740993 if range valid; seeded Number conversion must fail readback exactness.

### Machine fixtures — NOT_RUN product runtime

```json
[
  {
    "id": "DF-02-F1",
    "kind": "valid_schema",
    "canonicalOperation": "crm.updateCompany",
    "schemaAmendmentId": "DF-02-SCHEMA-1",
    "payload": {
      "company": {
        "workspaceId": "ws:test",
        "entityId": "company:acme"
      },
      "revenue": {
        "amountMinor": "1234567",
        "currency": "USD"
      }
    },
    "envelope": {
      "workspaceId": "ws:test",
      "commandId": "DF-02-intent1",
      "idempotencyKey": "DF-02-key1",
      "expectedRevision": "r7"
    },
    "expected": "Shapevalid thenACL/provider/CASsemantic validation; NOT_RUN runtime."
  },
  {
    "id": "DF-02-F2",
    "kind": "negative_schema",
    "schemaAmendmentId": "DF-02-SCHEMA-1",
    "payload": {
      "company": {
        "workspaceId": "ws:test",
        "entityId": "company:acme"
      },
      "revenue": {
        "amountMinor": "1234567",
        "currency": "USD"
      },
      "unrecognizedMutationField": "reject"
    },
    "expectedError": "INVALID_PAYLOAD unknown field; no mutation/providercall."
  }
]
```

## DF-03 — Контакт — связь с компанией и provenance

**Current / proposed:** Dossier.org is free text. Proposed link stores canonical Company ref and manual source actor/time. This form does not invent Contact create/rename/email verification APIs.

**Layout:** Contact header read-only «Имя», «Подтверждённый email», «Источник»; «Связать с компанией» opens authorized search/results+current/new link preview.

**Screen/controls:** CRM-04 / company-link, email. **WP:** WP-22, WP-23, WP-19. **Evidence:** R4-E01, R4-E04.

### Поля

| Field / RU label | Type / required | Default / source | Validation / coercion | Dirty / help |
|---|---|---|---|---|
| contactName · Имя контакта | readonly string / optional | "Contact projection.name"<br>email/manual/import provenance | Read-only; same name not identity<br>none | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Источник имени виден; одинаковое имя не объединяет записи. |
| verifiedEmail · Подтверждённый email | readonly string  /  null / optional | "verified contact address; absent→«Адрес не подтверждён»"<br>Contact source binding | Compose requires verified email; never guess email from name<br>Preserve mailbox local part; normalize only provider verified address; no stripping +tags/dots | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Этот адрес используется кнопкой «Написать письмо». |
| companySearch · Найти компанию | string / optional | ""<br>authorized CRM query | Search≤256 characters; only allowed companies; no hidden total<br>Trim query edges only; no relation mutation | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Можно связать только доступную компанию. |
| companyRef · Компания | Rox2EntityRef / required | "current company ref or no selection"<br>authorized picker result | Company kind/same workspace; fresh company.read plus contact.write at commit<br>Exact ref; no auto-company creation from typed text; cannot clear via this registered link action | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Выберите существующую компанию. Новый домен не заменяет связь автоматически. |
| contactRef · Контакт [immutable hidden binding] | readonly Rox2EntityRef / required | "current ref"<br>canonical context | Same workspace Contact, fresh revision<br>resolve alias before commit | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Ручная связь сохраняет источник и время. |

### Actions / typed contracts

#### Связать с компанией · crm.linkContactCompany

- Binding: CRM-04.commands[LinkContactCompany]; domain primary wire alias must be registered by WP22 without alternate repository; Revision4 canonical registration=crm.linkContactCompany owner=WP-22.
- Request schema: DF-03-SCHEMA-1.
- Input: Envelope+{contactRef:Rox2EntityRef,companyRef:Rox2EntityRef,baseRevision:number}.
- Result: {revision:number,receiptId:string,status:CanonicalStatus,provenance:{kind:manual,actorRef,at}}.
- Errors: denied, conflict, cross_scope.
- Transition: Validate fields → focus first error → fresh capability/revision → one durable intent/key → lock same form action → receipt/readback; never label queued as completed.
- Mapping: Existing leaf named command is authority entry. No fabricated REST route/canonical alias name; registering typed wire name is required WP22 contract work.

### Request mapping / schema amendments

- Persist canonical entity link + provenance atomically; old org display text may remain legacy projection, never identity authority.
- No manual Company/Contact create/edit controls exist in referenced screen registry; name/domain/email are readonly here. Any later identity editor needs explicit screen+operation extension.

```json
{
  "status": "PROPOSED_NORMATIVE_TARGET_OVERRIDE",
  "fields": {
    "contactRef": "contactRef",
    "companyRef": "companyRef",
    "baseRevision": "leaf numeric authorityrevision ifdocumented; canonical envelope token separate"
  },
  "envelope": "workspaceId/commandId/idempotencyKey/expectedRevision separate; actor authenticatedserver",
  "rejectUnknownFields": true,
  "registrationBoundary": "Any named secondary canonical operation above is proposed registration in same authority before UI dispatch. Exact request schema and examples provided; original leaf symbol retained as adapter provenance."
}
```

- **DF-03-SCHEMA-1 / o:** REQUIRED_BEFORE_UI_DISPATCH. Exact Draft07 payloadSchema в JSON; additionalProperties=false. semanticConstraints требуют server validation. Historical Revision2 не считается доказанным target.

### Видимые состояния

- **disabled:** Выберите доступную компанию.
- **loading:** Сохраняем связь…
- **error:** Контакт изменился. Проверьте текущую компанию.
- **success:** Контакт связан с компанией.
- **offline:** Нет связи. Изменения сохранены в черновике; операция не подтверждена.
- **reload:** Восстановить сохранённый baseline, незавершённый intent и отдельно несохранённые поля; повторный dispatch только того же immutable intent.
- **dirtyClose:** Есть несохранённые изменения. «Продолжить редактирование» / «Сохранить черновик» / «Закрыть без сохранения». Отправленный intent закрытием не отменяется.

### Focus / keyboard / help

- **focus:** Open→search; ↑↓ results; Enter choose, then explicit primary submit; Escape closes returns company-link.
- **keyboard:** No Enter selection double-submit; Cmd/Ctrl+Enter confirms after choice.
- **click:** Show current→new Company; explain no implicit mail sharing. email opens MAIL03 draft with account choice, never send.

Field-specific help доступен hover500ms, focus и отдельной кнопкой «Что это?», показывает смысл/единицы/source/asOf/example; не меняет значение. Ошибка aria-describedby, first invalid focus; IME/autocomplete consumes Enter.

**Permissions / provider:** contact.write+company.read for link; contact.read+mail.compose for email. Linking does not grant mail permission or create ACL inheritance.

### Owned implementation seams

- WP-22: apps/electron/src/renderer/pages/extra-screens/dossier/DossierPage.tsx — Contact detail linkage.
- WP-23: apps/electron/src/renderer/pages/extra-screens/dossier/dossier-model.ts — legacy identity adapter.
- WP-19: apps/electron/src/renderer/pages/inbox/mail/MailPanels.tsx — MailCompose.

### Domain examples — NOT_RUN

1. **valid** {"contactRef": "contact:alice", "companyRef": "company:acme", "baseRevision": 4} → Manual provenance+link written once; Company authorized Contacts projection includes same canonical Contact; compose remains unsent.
2. **negative** {"companyRef": "otherWorkspace/company:acme"} → cross_scope; no link/hidden title/count disclosure.

### Machine fixtures — NOT_RUN product runtime

```json
[
  {
    "id": "DF-03-F1",
    "kind": "valid_schema",
    "canonicalOperation": "crm.linkContactCompany",
    "schemaAmendmentId": "DF-03-SCHEMA-1",
    "payload": {
      "contactRef": {
        "workspaceId": "ws:test",
        "entityId": "contact:alice"
      },
      "companyRef": {
        "workspaceId": "ws:test",
        "entityId": "company:acme"
      },
      "baseRevision": 4
    },
    "envelope": {
      "workspaceId": "ws:test",
      "commandId": "DF-03-intent1",
      "idempotencyKey": "DF-03-key1",
      "expectedRevision": "r7"
    },
    "expected": "Shapevalid thenACL/provider/CASsemantic validation; NOT_RUN runtime."
  },
  {
    "id": "DF-03-F2",
    "kind": "negative_schema",
    "schemaAmendmentId": "DF-03-SCHEMA-1",
    "payload": {
      "contactRef": {
        "workspaceId": "ws:test",
        "entityId": "contact:alice"
      },
      "companyRef": {
        "workspaceId": "ws:test",
        "entityId": "company:acme"
      },
      "baseRevision": 4,
      "unrecognizedMutationField": "reject"
    },
    "expectedError": "INVALID_PAYLOAD unknown field; no mutation/providercall."
  }
]
```

## DF-04 — Письмо — черновик, получатели, вложения, отправка

**Current / proposed:** Preserve existing MailCompose/save-vs-send serialization and4000ms autosave; proposed provider-neutral account/draft revisions and submission receipts extend it.

**Layout:** Inbox compose: «От» account selector; «Кому»/«Копия»/«Скрытая копия» chips; «Тема»; multiline «Сообщение»; attachment rows with bytes/status; sticky «Сохранить черновик» + «Отправить».

**Screen/controls:** MAIL-03 / draft, send, attach. **WP:** WP-19, WP-17. **Evidence:** R4-E02, R4-E03, R4-E04.

### Поля

| Field / RU label | Type / required | Default / source | Validation / coercion | Dirty / help |
|---|---|---|---|---|
| accountRef · От | Rox2EntityRef / required | "existing draft account; new draft last explicitly selected authorized account, otherwise no selection"<br>MailAccount verified provider identity | Account belongs actor/workspace; draft account immutable once provider-backed; account revoked disables send<br>Choose account, never free-text From; switching unsaved new draft revalidates attachments and reply source | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Письмо отправляется от подключённого аккаунта. From нельзя подменить. |
| to · Кому | Address[] / optional | "reply: source.author verified; replyAll excludes own bound aliases; new empty"<br>draft/source exact addresses | At least1 recipient acrossTo/Cc/Bcc for send, not save; each parser-validated mailbox; CR/LF/header injection rejected; max1000 combined PROPOSED<br>Accept mailbox tokens separated comma/semicolon; display name separate; domain case-fold/IDNA; preserve local part/+tags/dots; duplicates exactnormalized address removed acrossTo→Cc→Bcc | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Получатели видят To/Cc. Bcc не выводится в shared projections. |
| cc · Копия | Address[] / optional | "draft/replyAll or[]"<br>draft/source | Same address rules; total≤1000<br>Same asTo; no guessed CRM expansion | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Получатели в копии видимы другим получателям. |
| bcc · Скрытая копия | Address[] / optional | "draft only, never source unseenBcc"<br>draft owner | Same address rules; never expose via shared source/backlink<br>Same asTo; only account owner-authorized data | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Скрытая копия не раскрывается участникам обсуждения. |
| subject · Тема | string / optional | "draft or explicit reply/forward subject; new empty"<br>source replySubject/draft | ≤998 Unicode codepoints PROPOSED; CR/LF rejected; empty allowed with explicit send confirmation<br>Preserve content; whitespace-only treated empty for warning, no auto-content | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Без темы можно отправить после подтверждения. |
| text · Сообщение | string / optional | "draft or reviewed quote; new empty"<br>user-authored body | ≤1MiB UTF8 text PROPOSED; no executable raw HTML; maintain editor-neutral serialization policy<br>Preserve whitespace/newlines; signature explicit not silently changed | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Текст черновика сохраняется отдельно от отправки. |
| attachments · Вложения | AttachmentRef[] / optional | "draft finalized refs or[]"<br>picker/drop/upload result boundaccount/draft | Each local file≤26214400bytes current; provider advertised total quota separately; finalized ready+authorized refs required send; account/blob relation checked<br>Native handle→owned upload→ref; raw filesystem path never remote request; remove chip explicit dirty | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Отображаются имя, размер и состояние. Загрузка ещё не равна готовому вложению. |

### Actions / typed contracts

#### Сохранить черновик · mail.saveDraft

- Binding: MAIL-03.commands[SaveDraft], same mail authority WP19; Revision4 canonical registration=mail.saveDraft owner=WP-19.
- Request schema: DF-04-SCHEMA-1.
- Input: Envelope+{draftRef?,accountRef,baseRevision?,body:DraftBody{to,cc,bcc,subject,text,mode,sourceRef?},attachmentRefs}.
- Result: {draftRef,revision,receiptId,status:CanonicalStatus}.
- Errors: conflict, invalid_recipient, oversize, denied.
- Transition: Save can contain incomplete recipients only as raw recoverable draft tokens; no invalid recipient sent. Debounce4000ms serial per draft, explicit CmdS flush; lastAck content snapshot compared before clearing dirty.
#### Отправить · mail.sendDraft

- Binding: WP-19.operations[mail.sendDraft]; MAIL-03.SendDraft.
- Request schema: DF-04-SCHEMA-2.
- Input: Envelope+{account:Rox2EntityRef,draft:Rox2EntityRef,draftRevision:string}.
- Result: {receiptId,submissionRef,operationState:accepted|pending|ambiguous,status:CanonicalStatus,providerMessageId?}.
- Errors: denied, provider_rejected, attachment_unavailable, conflict, invalid_recipient, external_blocked.
- Transition: Validate fields → focus first error → fresh capability/revision → one durable intent/key → lock same form action → receipt/readback; never label queued as completed.
- Mapping: First save latest exact draft snapshot; send that returned revision and current account. Freeze content/key until resolved. accepted means provider submission, never delivery/read.

### Request mapping / schema amendments

- SaveDraft exact fields formalized in existing leaf/mail DTO; do not add a separate compose backend.
- Primary account/draft/draftRevision names retained. Leaf draftRef/accountRef/baseRevision mapped explicitly using returned authority token, never parseInt.
- Draft invalid raw recipient preservation is recovery representation; validation failure remains visible and blocks send; persist separately from validated recipients.

```json
{
  "status": "PROPOSED_NORMATIVE_TARGET_OVERRIDE",
  "fields": {
    "accountRef": "SaveDraft.accountRef / SendDraft.account",
    "body": "SaveDraft.body immutable acksnapshot",
    "attachments": "SaveDraft.attachmentRefs account-owned finalizedrefs",
    "draftRef": "SaveDraft.draftRef / SendDraft.draft",
    "savedRevision": "SendDraft.draftRevision"
  },
  "envelope": "workspaceId/commandId/idempotencyKey/expectedRevision separate; actor authenticatedserver",
  "rejectUnknownFields": true,
  "registrationBoundary": "Any named secondary canonical operation above is proposed registration in same authority before UI dispatch. Exact request schema and examples provided; original leaf symbol retained as adapter provenance."
}
```

- **DF-04-SCHEMA-1 / save:** REQUIRED_BEFORE_UI_DISPATCH. Exact Draft07 payloadSchema в JSON; additionalProperties=false. semanticConstraints требуют server validation. Historical Revision2 не считается доказанным target.
- **DF-04-SCHEMA-2 / send:** REQUIRED_BEFORE_UI_DISPATCH. Exact Draft07 payloadSchema в JSON; additionalProperties=false. semanticConstraints требуют server validation. Historical Revision2 не считается доказанным target.

### Видимые состояния

- **disabled:** Проверьте получателей и дождитесь загрузки вложений.
- **loading:** Сохраняем черновик… / Передаём письмо серверу…
- **error:** Не удалось подтвердить отправку. Не отправляйте повторно; откройте «Проверить результат».
- **success:** Черновик сохранён. / Принято сервером — доставка не подтверждена.
- **offline:** Нет связи. Изменения сохранены в черновике; операция не подтверждена.
- **reload:** Восстановить сохранённый baseline, незавершённый intent и отдельно несохранённые поля; повторный dispatch только того же immutable intent.
- **dirtyClose:** Есть несохранённые изменения. «Продолжить редактирование» / «Сохранить черновик» / «Закрыть без сохранения». Отправленный intent закрытием не отменяется.

### Focus / keyboard / help

- **focus:** New draft→To; reply→body; firstinvalid address chip/body; failed save keeps focus/draft.
- **keyboard:** Plain Enter recipient commits chip/body newline; IME respected; CmdCtrlS save; CmdCtrlEnter explicit send once; Delete selected attachment chip removes.
- **click:** Send awaits save, disables duplicate dispatch; blank subject dialog «Отправить без темы»; picker cancel unchanged; help reachable focus+click.

Field-specific help доступен hover500ms, focus и отдельной кнопкой «Что это?», показывает смысл/единицы/source/asOf/example; не меняет значение. Ошибка aria-describedby, first invalid focus; IME/autocomplete consumes Enter.

**Permissions / provider:** mail.draft.write/mail.send/attachment.create; unsupported/revoked provider disabled with Connections link. Existing loopback external-blocked remains failure. Offline draft recovery allowed but remote send never success.

### Owned implementation seams

- WP-19: apps/electron/src/renderer/pages/inbox/mail/MailPanels.tsx — MailCompose.
- WP-19: apps/electron/src/main/mail/mail-service.ts — saveDraft/send.
- WP-17: apps/electron/src/shared/mail-local.ts — MailComposeInput.

### Domain examples — NOT_RUN

1. **valid** {"to": ["alice@example.org"], "cc": [], "bcc": [], "subject": "План", "text": "Здравствуйте", "attachments": []} → Saved revisionr8 then one mail.sendDraft/account/draft/r8; accepted label only receipt.
2. **negative** {"to": ["alice@example.org\\r\\nBcc:evil@example.org"], "attachments": []} → invalid_recipient; no provider call.
3. **negative** {"attachmentBytes": 26214401} → oversize; attachment row error/send disabled; unrelated valid draft retained.

### Machine fixtures — NOT_RUN product runtime

```json
[
  {
    "id": "DF-04-F1",
    "kind": "valid_schema",
    "canonicalOperation": "mail.sendDraft",
    "schemaAmendmentId": "DF-04-SCHEMA-2",
    "payload": {
      "account": {
        "workspaceId": "ws:test",
        "entityId": "mail-account:a"
      },
      "draft": {
        "workspaceId": "ws:test",
        "entityId": "mail-draft:d1"
      },
      "draftRevision": "r8"
    },
    "envelope": {
      "workspaceId": "ws:test",
      "commandId": "DF-04-intent1",
      "idempotencyKey": "DF-04-key1",
      "expectedRevision": "r7"
    },
    "expected": "Shapevalid thenACL/provider/CASsemantic validation; NOT_RUN runtime."
  },
  {
    "id": "DF-04-F2",
    "kind": "negative_schema",
    "schemaAmendmentId": "DF-04-SCHEMA-2",
    "payload": {
      "account": {
        "workspaceId": "ws:test",
        "entityId": "mail-account:a"
      },
      "draft": {
        "workspaceId": "ws:test",
        "entityId": "mail-draft:d1"
      },
      "draftRevision": "r8",
      "unrecognizedMutationField": "reject"
    },
    "expectedError": "INVALID_PAYLOAD unknown field; no mutation/providercall."
  }
]
```

## DF-05 — Запланированная отправка и отмена гонки

**Current / proposed:** Scheduled durable send is proposed; current compose has no verified remote scheduling worker. It must not depend on open renderer or setTimeout.

**Layout:** Compose «Отправить позже» opens civil date/time+zone, UTC/offset preview and frozen draft version; receipt card «Запланировано» + «Отменить отправку».

**Screen/controls:** MAIL-04 / schedule, cancel. **WP:** WP-21, WP-19. **Evidence:** R4-E02, R4-E04.

### Поля

| Field / RU label | Type / required | Default / source | Validation / coercion | Dirty / help |
|---|---|---|---|---|
| sendDate · Дата отправки | YYYY-MM-DD / required | "no implicit date; suggested next valid slot is preview only"<br>user date picker | Valid civil date; resulting instant>serverNow at commit<br>Strict calendar parse, no Date browser locale parsing | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Дата интерпретируется в выбранной зоне. |
| sendTime · Время отправки | HH:mm / required | "no implicit time"<br>user | 00:00..23:59; DST gap rejected; fold requires explicit earlier/later choice<br>Resolve civildate+time+IANAzone via temporal resolver | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>При переводе часов нужно выбрать точное смещение. |
| timeZone · Часовой пояс | IANA zone / required | "account/calendar workspace preference if valid, otherwise explicit selection"<br>configured preference | Valid versioned tz database identifier<br>Preserve IANA ID; UTC preview shows exact offset | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Сервер хранит UTC instant и выбранную зону; смена зоны не скрыто сдвигает момент. |
| draftRevision · Версия черновика | readonly revision token / required | "lastAck saved draft revision"<br>SaveDraft receipt | Latest acknowledged snapshot; freeze owner/account/attachment relation; source edits invalidate schedule preview<br>no numeric coercion | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Для отправки будет использована эта сохранённая версия. |
| scheduleId · Идентификатор отправки [immutable hidden binding] | readonly string / optional | "schedule receipt if exists"<br>authority | Cancel requires existing id/revision; no client forged schedule<br>none | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Отмена зависит от того, успел ли worker начать передачу. |

### Actions / typed contracts

#### Отправить позже · mail.scheduleSend

- Binding: WP-21.operations[mail.scheduleSend].
- Request schema: DF-05-SCHEMA-1.
- Input: Envelope+{account,draft,sendAt:RFC3339instant,timeZone:IANA}.
- Result: {scheduleId,revision,receiptId,operationState:scheduled,status:CanonicalStatus}.
- Errors: past_time, unsupported, denied, conflict.
- Transition: Validate fields → focus first error → fresh capability/revision → one durable intent/key → lock same form action → receipt/readback; never label queued as completed.
- Mapping: SaveDraft revision included in expectedRevision envelope/frozen snapshot; sendAt computed once after explicit DST choice.
#### Отменить отправку · mail.cancelScheduledSend

- Binding: MAIL-04.commands[CancelScheduledSend]; Revision4 canonical registration=mail.cancelScheduledSend owner=WP-21.
- Request schema: DF-05-SCHEMA-2.
- Input: Envelope+{scheduleId,baseRevision:number}.
- Result: {receiptId,operationState:cancelled|already_claimed|sent|ambiguous,status:CanonicalStatus}.
- Errors: conflict, denied.
- Transition: CAS cancellation; cancelled only terminal worker cancellation receipt; already_claimed/sent/ambiguous does not display success cancellation.

### Request mapping / schema amendments

- Schedule payload binds exact draft revision/account; current primary request lacks explicit revision field, require envelope.expectedRevision validated/frozen by authority.
- Cancel keeps existing named leaf operation; do not invent per-provider scheduling UI authority.

```json
{
  "status": "PROPOSED_NORMATIVE_TARGET_OVERRIDE",
  "fields": {
    "accountRef": "account",
    "draftRef": "draft",
    "civilDateTimeZoneOffset": "Temporalresolve→sendAt UTC + timeZone",
    "draftRevision": "envelope.expectedRevision/frozen snapshot"
  },
  "envelope": "workspaceId/commandId/idempotencyKey/expectedRevision separate; actor authenticatedserver",
  "rejectUnknownFields": true,
  "registrationBoundary": "Any named secondary canonical operation above is proposed registration in same authority before UI dispatch. Exact request schema and examples provided; original leaf symbol retained as adapter provenance."
}
```

- **DF-05-SCHEMA-1 / schedule:** REQUIRED_BEFORE_UI_DISPATCH. Exact Draft07 payloadSchema в JSON; additionalProperties=false. semanticConstraints требуют server validation. Historical Revision2 не считается доказанным target.
- **DF-05-SCHEMA-2 / cancel:** REQUIRED_BEFORE_UI_DISPATCH. Exact Draft07 payloadSchema в JSON; additionalProperties=false. semanticConstraints требуют server validation. Historical Revision2 не считается доказанным target.

### Видимые состояния

- **disabled:** Выберите будущее время и сохраните черновик.
- **loading:** Планируем отправку… / Запрашиваем отмену…
- **error:** Отправка уже началась. Отмену подтвердить нельзя.
- **success:** Запланировано на {localDateTime} ({zone}, {offset}). / Отправка отменена.
- **offline:** Нет связи. Изменения сохранены в черновике; операция не подтверждена.
- **reload:** Восстановить сохранённый baseline, незавершённый intent и отдельно несохранённые поля; повторный dispatch только того же immutable intent.
- **dirtyClose:** Есть несохранённые изменения. «Продолжить редактирование» / «Сохранить черновик» / «Закрыть без сохранения». Отправленный intent закрытием не отменяется.

### Focus / keyboard / help

- **focus:** Date first; ambiguous offset choice focused; cancellation result live region; Escape returnsschedule trigger without cancel.
- **keyboard:** Date/time text editable; arrows fold radios; CmdCtrlEnter schedules; Enter cancel explicit button.
- **click:** Changing zone recomputes preview and dirty; user re-confirms exactinstant; cancellation no undo-toast fabrication.

Field-specific help доступен hover500ms, focus и отдельной кнопкой «Что это?», показывает смысл/единицы/source/asOf/example; не меняет значение. Ошибка aria-describedby, first invalid focus; IME/autocomplete consumes Enter.

**Permissions / provider:** mail.schedule/mail.schedule.write, server worker/provider capabilities ready; fixture cannot enablelive scheduling. Unsupported returns «Этот аккаунт не поддерживает запланированную отправку».

### Owned implementation seams

- WP-21: apps/electron/src/renderer/pages/inbox/mail/MailPanels.tsx — schedule card in compose.
- WP-21: apps/electron/src/renderer/pages/InboxPage.tsx — scheduled status mount.

### Domain examples — NOT_RUN

1. **valid** {"sendDate": "2026-10-25", "sendTime": "02:30", "timeZone": "Europe/Berlin", "offsetChoice": "later"} → 2026-10-25T01:30:00Z immutable schedule instant; one durable dispatch even renderer closes.
2. **negative** {"sendDate": "2027-03-28", "sendTime": "02:30", "timeZone": "Europe/Berlin"} → Nonexistent local time; no instant/no schedule.
3. **negative** {"cancelAfterClaim": true} → already_claimed or ambiguous, never «Отправка отменена»; reconcile same intent.

### Machine fixtures — NOT_RUN product runtime

```json
[
  {
    "id": "DF-05-F1",
    "kind": "valid_schema",
    "canonicalOperation": "mail.scheduleSend",
    "schemaAmendmentId": "DF-05-SCHEMA-1",
    "payload": {
      "account": {
        "workspaceId": "ws:test",
        "entityId": "mail-account:a"
      },
      "draft": {
        "workspaceId": "ws:test",
        "entityId": "mail-draft:d1"
      },
      "sendAt": "2026-10-25T01:30:00Z",
      "timeZone": "Europe/Berlin"
    },
    "envelope": {
      "workspaceId": "ws:test",
      "commandId": "DF-05-intent1",
      "idempotencyKey": "DF-05-key1",
      "expectedRevision": "r7"
    },
    "expected": "Shapevalid thenACL/provider/CASsemantic validation; NOT_RUN runtime."
  },
  {
    "id": "DF-05-F2",
    "kind": "negative_schema",
    "schemaAmendmentId": "DF-05-SCHEMA-1",
    "payload": {
      "account": {
        "workspaceId": "ws:test",
        "entityId": "mail-account:a"
      },
      "draft": {
        "workspaceId": "ws:test",
        "entityId": "mail-draft:d1"
      },
      "sendAt": "2026-10-25T01:30:00Z",
      "timeZone": "Europe/Berlin",
      "unrecognizedMutationField": "reject"
    },
    "expectedError": "INVALID_PAYLOAD unknown field; no mutation/providercall."
  }
]
```

## DF-06 — Неоднозначная отправка — проверка результата

**Current / proposed:** Current local send closes compose on ok. Proposed neutral submission ledger retains unknown external effect; no exactly-once delivery claim.

**Layout:** Receipt card: «Результат отправки не подтверждён»; readonly account/subject/send attempt timestamp; «Проверить результат»; evidence readback section. No automatic/manual resend control added to current registry.

**Screen/controls:** MAIL-04 / reconcile. **WP:** WP-21, WP-19. **Evidence:** R4-E02, R4-E04.

### Поля

| Field / RU label | Type / required | Default / source | Validation / coercion | Dirty / help |
|---|---|---|---|---|
| submissionRef · Отправка | readonly Rox2EntityRef / required | "last send receipt"<br>mail submission authority | Authorized same account/draft/workspace; no guessed MessageID global lookup<br>none | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Проверяется одна первоначальная попытка. |
| providerEvidence · Подтверждение сервера | readonly ProviderReceipt  /  null / optional | "persisted provider receipt or none"<br>authorized reconciliation lookup | Receipt provider/account/message/submission matching; no unrelated same-subject proof<br>Do not fabricate evidence from cached Sent list; displayasOf/source | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Принято сервером не равно доставлено адресату. |
| checkedAt · Последняя проверка | readonly RFC3339  /  null / optional | "receipt checkedAt; none→«Ещё не проверяли»"<br>authority | No use renderer open time as freshness<br>format local zone plus raw UTC help | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Показывается время фактической проверки. |

### Actions / typed contracts

#### Проверить результат · mail.reconcileSend

- Binding: MAIL-04.queries[GetSubmissionReceipt]; Revision4 canonical registration=mail.reconcileSend owner=WP-19.
- Request schema: DF-06-SCHEMA-1.
- Input: {submissionRef:Rox2EntityRef}.
- Result: {state:accepted|pending|ambiguous|rejected,sendAt?,providerEvidence?:ProviderReceipt,revision,asOf}.
- Errors: denied, not_found, provider_unavailable.
- Transition: Durable reconciliation intent for original submission; lookup/readback only, no mail send endpoint. Return accepted/pending/ambiguous/rejected evidence; query GetSubmissionReceipt remains read projection.

### Request mapping / schema amendments

- GetSubmissionReceipt remains same named query; if lookup itself triggers worker reconciliation, dispatch is internal same submission authority, not a new send.
- Unknown external effect retains original key/request hash; operation lifecycle unknown+verification unverified until scoped evidence. No forced ambiguous→failed.

```json
{
  "status": "PROPOSED_NORMATIVE_TARGET_OVERRIDE",
  "fields": {
    "submissionRef": "GetSubmissionReceipt.submissionRef",
    "providerEvidence": "readonly output; never callerattestation"
  },
  "envelope": "workspaceId/commandId/idempotencyKey/expectedRevision separate; actor authenticatedserver",
  "rejectUnknownFields": true,
  "registrationBoundary": "Any named secondary canonical operation above is proposed registration in same authority before UI dispatch. Exact request schema and examples provided; original leaf symbol retained as adapter provenance."
}
```

- **DF-06-SCHEMA-1 / o:** REQUIRED_BEFORE_UI_DISPATCH. Exact Draft07 payloadSchema в JSON; additionalProperties=false. semanticConstraints требуют server validation. Historical Revision2 не считается доказанным target.

### Видимые состояния

- **disabled:** Этот аккаунт не позволяет проверить результат; повторная отправка может создать дубликат.
- **loading:** Проверяем исходную отправку…
- **error:** Подтверждение пока не найдено. Письмо могло быть отправлено.
- **success:** Принято сервером: {providerReceiptAt}. Доставка не подтверждена.
- **offline:** Нет связи. Изменения сохранены в черновике; операция не подтверждена.
- **reload:** Восстановить сохранённый baseline, незавершённый intent и отдельно несохранённые поля; повторный dispatch только того же immutable intent.
- **dirtyClose:** Есть несохранённые изменения. «Продолжить редактирование» / «Сохранить черновик» / «Закрыть без сохранения». Отправленный intent закрытием не отменяется.

### Focus / keyboard / help

- **focus:** Check button; after result announce inline; receipt details focusable; no forceddialogclose.
- **keyboard:** Enter check; CmdCtrlEnter inside receipt never sends; Escape closes presentation only.
- **click:** Evidence details show source/account/time, redact recipients beyondpermission; no «Повторить» mutation inthisform.

Field-specific help доступен hover500ms, focus и отдельной кнопкой «Что это?», показывает смысл/единицы/source/asOf/example; не меняет значение. Ошибка aria-describedby, first invalid focus; IME/autocomplete consumes Enter.

**Permissions / provider:** mail.submission.read; unavailable provider/missing lookup distinct from negative proof; SMTP may remain ambiguous without reliable lookup.

### Owned implementation seams

- WP-21: apps/electron/src/renderer/pages/inbox/mail/MailPanels.tsx — submission status.
- WP-19: apps/electron/src/renderer/pages/inbox/mail/useMail.ts — send receipt/reconcile.

### Domain examples — NOT_RUN

1. **valid** {"submissionRef": "submission:s1", "providerMessageId": "p1", "lostAck": true} → Lookup scopedaccount proves originalaccepted; no additional message/provider send.
2. **negative** {"lookupUnsupported": true} → Stateambiguous remains; buttonexplanation; no retry provider action/no fake failure.

### Machine fixtures — NOT_RUN product runtime

```json
[
  {
    "id": "DF-06-F1",
    "kind": "valid_schema",
    "canonicalOperation": "mail.reconcileSend",
    "schemaAmendmentId": "DF-06-SCHEMA-1",
    "payload": {
      "submissionRef": {
        "workspaceId": "ws:test",
        "entityId": "mail-submission:s1"
      }
    },
    "envelope": {
      "workspaceId": "ws:test",
      "commandId": "DF-06-intent1",
      "idempotencyKey": "DF-06-key1",
      "expectedRevision": "r7"
    },
    "expected": "Shapevalid thenACL/provider/CASsemantic validation; NOT_RUN runtime."
  },
  {
    "id": "DF-06-F2",
    "kind": "negative_schema",
    "schemaAmendmentId": "DF-06-SCHEMA-1",
    "payload": {
      "submissionRef": {
        "workspaceId": "ws:test",
        "entityId": "mail-submission:s1"
      },
      "unrecognizedMutationField": "reject"
    },
    "expectedError": "INVALID_PAYLOAD unknown field; no mutation/providercall."
  }
]
```

## DF-07 — Событие Calendar — редактор полей и provider echo

**Current / proposed:** Current CalendarEvent narrower account-scoped model and unavailable production adapter. Proposed full editor keeps same Meetings representation and canonical event identity.

**Layout:** Meetings→Calendar→slot/event editor: calendar, «Название», all-day toggle, date/timezone/start/end, attendees, location/link, description; provider status/revision; «Сохранить событие».

**Screen/controls:** CAL-02 / save. **WP:** WP-28. **Evidence:** R4-E05, R4-E06.

### Поля

| Field / RU label | Type / required | Default / source | Validation / coercion | Dirty / help |
|---|---|---|---|---|
| calendarRef · Календарь | Rox2EntityRef / required | "existing event calendar readonly; new event user-selected writable calendar"<br>authorized account/calendar list | Ownedconnection withwritecapability; movingexistingcalendar not supportedbythisform<br>No auto-first write calendar; readonly for existing event | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Права и синхронизация определяются выбранным календарём. |
| title · Название | string / required | "eventtitle or empty"<br>user/event | Trimmed1..512codepoints PROPOSED; no CR/LF<br>Trim edges; preserve internal spaces | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Название видно участникам согласно правилам календаря. |
| allDay · Весь день | boolean / required | "eventallDay or false"<br>current/explicittoggle | Timed/all-day discriminated union; no mixed fields<br>Toggle previews converted dates; do not silently reinterpret boundary instant | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Для события на весь день хранятся гражданские даты, не24часа. |
| timeZone · Часовой пояс | IANAzone / required | "eventzone; newcalendar preference otherwise explicit"<br>calendar event | Valid IANA; DST rule DF09<br>Display civilandinstant preview; no guessingbrowserzone | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Время участников может отличаться; хранится выбранная зона. |
| start · Начало | wallTime YYYY-MM-DDTHH:mm OR allDay YYYY-MM-DD / required | "existing event or selectedslot"<br>user/grid | Validlocaltime; fold requiresoffsetchoice; gapinvalid<br>Timed→RFC3339instant; allDay→civilstart ineventzone | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Неоднозначное время требует выбора смещения. |
| end · Окончание | wallTime OR inclusive UI allDay date / required | "event or suggestedslotend preview"<br>user/grid | Timed endinstant>startinstant; allDay inclusiveend≥startdate<br>UI allDay finalday→stored nextcivilDate exclusive; not +86400000ms | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>В календаре конец all-day хранится исключительной датой следующего дня. |
| attendees · Участники | Attendee[] / optional | "provider existing list or[]"<br>validated emailpicker | ≤1000; mail parser noCRLF; own RSVP noteditablehere; others statusread-only unlessproviderorganizer capability<br>Dedup exactemail; preserveproviderroles; newrequired attendee needs_action | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Добавление email не выдаёт Workspaceдоступ. |
| location · Место | string / optional | "event location or empty"<br>provider/user | ≤2048codepoints; no executablemarkup<br>Trimedges | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Адрес или название места. |
| meetingLink · Ссылка на встречу | https URL  /  null / optional | "provider link ornull"<br>provider/user | https only; no credentials/javascript/data; openingexternalexplicit<br>ParseURL; no create room side-effect | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Ссылка не подтверждает доступность аудио/видео. |
| description · Описание | string / optional | "eventdescription or empty"<br>user/provider | ≤10000codepoints; sanitizepreview; no permissionexpansionbymentions<br>Preservetext; rich contentvalidatedcommon representation | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Описание синхронизируется с провайдером; приватные sourcequotes требуют policy. |

### Actions / typed contracts

#### Сохранить событие · calendar.updateEvent

- Binding: WP-28.operations[calendar.updateEvent]; CAL-02.UpdateCalendarEvent.
- Request schema: DF-07-SCHEMA-1.
- Input: Envelope+{event:Rox2EntityRef,providerEtag:string,title?,start?:TemporalValue,end?:TemporalValue,attendees?:Attendee[],allDay?,timeZone?,location?,meetingLink?,description?}.
- Result: {receiptId,eventRef,revision?,operationState:committed|reconciling,status:CanonicalStatus,normalizedEvent?}.
- Errors: denied, invalid_interval, invalid_local_time, ambiguous_local_time, provider_conflict, provider_rejected, unsupported_capability.
- Transition: Validate fields → focus first error → fresh capability/revision → one durable intent/key → lock same form action → receipt/readback; never label queued as completed.
- Mapping: Formpatch mapped to same existing primary handler. Add listed editor fields to schema (currently onlystart/end/attendees/etag) before UI submits. provider normalized response replaces baseline only afterreceipt.
#### Сохранить событие · calendar.createEvent

- Binding: CAL-02.commands[CreateCalendarEvent]; Revision4 canonical registration=calendar.createEvent owner=WP-28.
- Request schema: DF-07-SCHEMA-2.
- Input: Envelope+{calendarRef,event:CalendarCreateInput{title,start,end,allDay,timeZone,attendees,location?,meetingLink?,description?}}.
- Result: {eventRef,receiptId,operationState:committed|reconciling,status:CanonicalStatus}.
- Errors: denied, invalid_interval, provider_rejected.
- Transition: Validate fields → focus first error → fresh capability/revision → one durable intent/key → lock same form action → receipt/readback; never label queued as completed.
- Mapping: Existing leafCreate command onecalendar module; reserveprovider createid byintent. Remote success+local persistencefailure becomesreconciling, not new create retry.

### Request mapping / schema amendments

- TemporalValue targetnormative union instant{valueRFC3339,timeZone}|all_day{valueYYYY-MM-DD,timeZone}; wall_time isform intermediate only untilDSTresolved.
- Source CalendarEvent numeric startAt/endAt remains legacyprojectionadapter ofnormalized instants; all-day dates stored in targetDTO not reconstructed from24h.
- Explicit schema extension requiredtitle/allDay/timeZone/description/location/link/calendarcreate; no duplicate calendar service.

```json
{
  "status": "PROPOSED_NORMATIVE_TARGET_OVERRIDE",
  "fields": {
    "eventRef": "event",
    "providerEtag": "providerEtag",
    "startEnd": "resolved TemporalValue; allDay exclusiveend civil date",
    "existingCalendarRef": "immutable; not submitted; movingcalendar unavailable",
    "createCalendarRef": "CreateCalendarEvent.calendarRef",
    "titleDescriptionLocation": "validated known patch fields; no hidden schema stripping"
  },
  "envelope": "workspaceId/commandId/idempotencyKey/expectedRevision separate; actor authenticatedserver",
  "rejectUnknownFields": true,
  "registrationBoundary": "Any named secondary canonical operation above is proposed registration in same authority before UI dispatch. Exact request schema and examples provided; original leaf symbol retained as adapter provenance."
}
```

- **DF-07-SCHEMA-1 / update:** REQUIRED_BEFORE_UI_DISPATCH. Exact Draft07 payloadSchema в JSON; additionalProperties=false. semanticConstraints требуют server validation. Historical Revision2 не считается доказанным target.
- **DF-07-SCHEMA-2 / create:** REQUIRED_BEFORE_UI_DISPATCH. Exact Draft07 payloadSchema в JSON; additionalProperties=false. semanticConstraints требуют server validation. Historical Revision2 не считается доказанным target.

### Видимые состояния

- **disabled:** Календарь пока не поддерживает запись. Проверьте подключение.
- **loading:** Сохраняем у провайдера…
- **error:** Провайдер изменил событие. Сравните версии; ваш черновик сохранён.
- **success:** Событие сохранено. / Провайдер принял изменение; завершаем синхронизацию.
- **offline:** Нет связи. Изменения сохранены в черновике; операция не подтверждена.
- **reload:** Восстановить сохранённый baseline, незавершённый intent и отдельно несохранённые поля; повторный dispatch только того же immutable intent.
- **dirtyClose:** Есть несохранённые изменения. «Продолжить редактирование» / «Сохранить черновик» / «Закрыть без сохранения». Отправленный intent закрытием не отменяется.

### Focus / keyboard / help

- **focus:** New→title; invalid→firstfield; providerconflict→comparepanel, no overwrite; Escape dirtyreview.
- **keyboard:** CmdCtrlEnter save; Enterdescriptionnewline; allDaycheckboxSpace; calendarselectionEnter noautosave.
- **click:** Preview attendees/timezone/full instant; restore normalized provider echo, notoptimisticgreen.

Field-specific help доступен hover500ms, focus и отдельной кнопкой «Что это?», показывает смысл/единицы/source/asOf/example; не меняет значение. Ошибка aria-describedby, first invalid focus; IME/autocomplete consumes Enter.

**Permissions / provider:** calendar.event.write and providerorganizer permissions; RSVPseparateDF08; production adapter unavailable untilprovider-liveevidence, fixturelabelvisible.

### Owned implementation seams

- WP-28: apps/electron/src/renderer/components/meetings/CalendarEventEditor.tsx — CalendarEventEditor.
- WP-28: apps/electron/src/renderer/components/meetings/CalendarGrid.tsx — event edit/drop.

### Domain examples — NOT_RUN

1. **valid** {"allDay": true, "start": "2026-03-29", "end": "2026-03-29", "timeZone": "Europe/Berlin"} → Stored civilstart2026-03-29/endExclusive2026-03-30;23h interval, not86400000ms.
2. **negative** {"start": "2026-10-01T12:00", "end": "2026-10-01T11:00", "timeZone": "Europe/Moscow"} → invalid_interval; no providerwrite.
3. **negative** {"providerApplied": true, "localCommitFailed": true} → reconciling receipt; retry same intent recovers oneevent, no secondinvitation.

### Machine fixtures — NOT_RUN product runtime

```json
[
  {
    "id": "DF-07-F1",
    "kind": "valid_schema",
    "canonicalOperation": "calendar.updateEvent",
    "schemaAmendmentId": "DF-07-SCHEMA-1",
    "payload": {
      "event": {
        "workspaceId": "ws:test",
        "entityId": "calendar-event:e1"
      },
      "providerEtag": "etag7",
      "title": "Планирование",
      "start": {
        "kind": "all_day",
        "value": "2026-03-29",
        "timeZone": "Europe/Berlin"
      },
      "end": {
        "kind": "all_day",
        "value": "2026-03-30",
        "timeZone": "Europe/Berlin"
      },
      "allDay": true,
      "timeZone": "Europe/Berlin",
      "attendees": []
    },
    "envelope": {
      "workspaceId": "ws:test",
      "commandId": "DF-07-intent1",
      "idempotencyKey": "DF-07-key1",
      "expectedRevision": "r7"
    },
    "expected": "Shapevalid thenACL/provider/CASsemantic validation; NOT_RUN runtime."
  },
  {
    "id": "DF-07-F2",
    "kind": "negative_schema",
    "schemaAmendmentId": "DF-07-SCHEMA-1",
    "payload": {
      "event": {
        "workspaceId": "ws:test",
        "entityId": "calendar-event:e1"
      },
      "providerEtag": "etag7",
      "title": "Планирование",
      "start": {
        "kind": "all_day",
        "value": "2026-03-29",
        "timeZone": "Europe/Berlin"
      },
      "end": {
        "kind": "all_day",
        "value": "2026-03-30",
        "timeZone": "Europe/Berlin"
      },
      "allDay": true,
      "timeZone": "Europe/Berlin",
      "attendees": [],
      "unrecognizedMutationField": "reject"
    },
    "expectedError": "INVALID_PAYLOAD unknown field; no mutation/providercall."
  }
]
```

## DF-08 — RSVP — ответ своего аккаунта

**Current / proposed:** Own-attendee RSVP proposed separately from current narrower local CalendarEvent; editing event fields and own response distinct capabilities.

**Layout:** Eventdetail «Ваш ответ» with ownedaccount selector whenmultiple + radios «Принять»/«Возможно»/«Отклонить» + «Применить ответ».

**Screen/controls:** CAL-02 / rsvp. **WP:** WP-28. **Evidence:** R4-E05, R4-E06.

### Поля

| Field / RU label | Type / required | Default / source | Validation / coercion | Dirty / help |
|---|---|---|---|---|
| attendeeAccountRef · Ответить от аккаунта | Rox2EntityRef / required | "exactevent own attendee binding; ifmultiple noautochoice"<br>authenticatedownedaccounts matchedserver-side | Immutableprovideraccount binding; event includesresolved ownemail; accountnotrevoked<br>Userselectsaccountref; caller cannot send arbitraryattendeeemail | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Меняется только ответ вашего аккаунта. |
| response · Ваш ответ | accepted  /  tentative  /  declined / required | "persisted ownresponse; needs_action→no selection"<br>provider normalizedattendee | Exactenum; no organizerstatus forotherattendee<br>RUradio↔enum; no needs_actionsubmission | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Принять — участие подтверждено; Возможно — предварительный ответ; Отклонить — не участвую. |
| providerEtag · Версия у провайдера [immutable hidden binding] | readonly string / required | "GetCalendarEvent.etag"<br>provider | CASifprovider supports; mismatchconflict; absentetag notblindwrite<br>no stringfabrication | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Параллельный ответ требует повторного чтения. |

### Actions / typed contracts

#### Применить ответ · calendar.event.rsvp

- Binding: CAL-02.commands[RsvpCalendarEvent]; cloud supplement separateOperations.
- Request schema: DF-08-SCHEMA-1.
- Input: Envelope+{eventRef,attendeeAccountRef,response,baseRevision,providerEtag?}.
- Result: {eventRef,response:CalendarAttendeeResponse,revision?,receiptId,operationState:committed|reconciling,status:CanonicalStatus}.
- Errors: denied, attendee_mismatch, account_binding_mismatch, unsupported_capability, provider_conflict, provider_rejected, account_revoked.
- Transition: Validate fields → focus first error → fresh capability/revision → one durable intent/key → lock same form action → receipt/readback; never label queued as completed.

### Request mapping / schema amendments

- One dedicated own-RSVP operation; never reuse organizer fullpatch updateEvent. Accountemail resolved onlyserver-side.
- Provider-specific token scopes/capability required; no local success-only RSVP whenprovider unavailable.

```json
{
  "status": "PROPOSED_NORMATIVE_TARGET_OVERRIDE",
  "fields": {
    "eventRef": "eventRef",
    "ownedAccount": "attendeeAccountRef; server resolves ownattendee email",
    "response": "response",
    "baseRevision": "leaf revision viaauthority mapping; notetag"
  },
  "envelope": "workspaceId/commandId/idempotencyKey/expectedRevision separate; actor authenticatedserver",
  "rejectUnknownFields": true,
  "registrationBoundary": "Any named secondary canonical operation above is proposed registration in same authority before UI dispatch. Exact request schema and examples provided; original leaf symbol retained as adapter provenance."
}
```

- **DF-08-SCHEMA-1 / o:** REQUIRED_BEFORE_UI_DISPATCH. Exact Draft07 payloadSchema в JSON; additionalProperties=false. semanticConstraints требуют server validation. Historical Revision2 не считается доказанным target.

### Видимые состояния

- **disabled:** Этот аккаунт не является вашим участником события.
- **loading:** Передаём ваш ответ…
- **error:** Аккаунт не соответствует участнику события. Выберите другой аккаунт.
- **success:** Ответ подтверждён провайдером. / Ответ принят; проверяем синхронизацию.
- **offline:** Нет связи. Изменения сохранены в черновике; операция не подтверждена.
- **reload:** Восстановить сохранённый baseline, незавершённый intent и отдельно несохранённые поля; повторный dispatch только того же immutable intent.
- **dirtyClose:** Есть несохранённые изменения. «Продолжить редактирование» / «Сохранить черновик» / «Закрыть без сохранения». Отправленный intent закрытием не отменяется.

### Focus / keyboard / help

- **focus:** Accountifmultiple, elsecurrent radio; providerconflict readsameownattendee without changingdraft.
- **keyboard:** ↑↓ radio; Spacechooses; Enterexplicitapply; no submit whileaccountpickercomposing.
- **click:** ReadonlyeventmaypermitownRSVP; selectingresponse onlydraft; no hiddenotherattendeechange.

Field-specific help доступен hover500ms, focus и отдельной кнопкой «Что это?», показывает смысл/единицы/source/asOf/example; не меняет значение. Ошибка aria-describedby, first invalid focus; IME/autocomplete consumes Enter.

**Permissions / provider:** calendar.rsvp plusprovider own-rsvp; organizeredit not requiredifprovider permits ownresponse. revokedaccount disabledwithConnections.

### Owned implementation seams

- WP-28: apps/electron/src/renderer/components/meetings/CalendarEventEditor.tsx — own RSVP section.

### Domain examples — NOT_RUN

1. **valid** {"eventReadOnly": true, "ownRsvpCapability": true, "response": "tentative"} → Onlyownattendee responseupdated; eventtitle/time unchanged.
2. **negative** {"attendeeAccountRef": "account:b", "eventOwnAttendeeAccount": "account:a"} → account_binding_mismatch beforeproviderwrite.

### Machine fixtures — NOT_RUN product runtime

```json
[
  {
    "id": "DF-08-F1",
    "kind": "valid_schema",
    "canonicalOperation": "calendar.event.rsvp",
    "schemaAmendmentId": "DF-08-SCHEMA-1",
    "payload": {
      "eventRef": {
        "workspaceId": "ws:test",
        "entityId": "calendar-event:e1"
      },
      "attendeeAccountRef": {
        "workspaceId": "ws:test",
        "entityId": "calendar-account:a"
      },
      "response": "tentative",
      "baseRevision": 7,
      "providerEtag": "etag7"
    },
    "envelope": {
      "workspaceId": "ws:test",
      "commandId": "DF-08-intent1",
      "idempotencyKey": "DF-08-key1",
      "expectedRevision": "r7"
    },
    "expected": "Shapevalid thenACL/provider/CASsemantic validation; NOT_RUN runtime."
  },
  {
    "id": "DF-08-F2",
    "kind": "negative_schema",
    "schemaAmendmentId": "DF-08-SCHEMA-1",
    "payload": {
      "eventRef": {
        "workspaceId": "ws:test",
        "entityId": "calendar-event:e1"
      },
      "attendeeAccountRef": {
        "workspaceId": "ws:test",
        "entityId": "calendar-account:a"
      },
      "response": "tentative",
      "baseRevision": 7,
      "providerEtag": "etag7",
      "unrecognizedMutationField": "reject"
    },
    "expectedError": "INVALID_PAYLOAD unknown field; no mutation/providercall."
  }
]
```

## DF-09 — Повторяющееся событие — scope и DST

**Current / proposed:** Current recurrence string/occurrences reader exists; full provider scopes and ambiguous-local-time resolution proposed. Never promote unsupported following toseries.

**Layout:** Recurringeventsave→scope dialog radios «Это событие»/«Это и следующие»/«Вся серия»; exactoriginaloccurrence and affected-range preview; timefold selector ineditor.

**Screen/controls:** CAL-02 / series, save. **WP:** WP-29, WP-28. **Evidence:** R4-E05, R4-E06.

### Поля

| Field / RU label | Type / required | Default / source | Validation / coercion | Dirty / help |
|---|---|---|---|---|
| scope · Применить изменение | instance  /  following  /  series / required | "no default confirmation; usermustchoose"<br>recurringeventsavecontext | Provider advertisedscope support; following disabledreason if unsupported<br>instance→primaryscopeone; series→series; following→following | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>«Это событие» создаёт исключение; «Это и следующие» может разделить серию. |
| originalStart · Исходное начало экземпляра | readonly RFC3339 or original civil allDaydate / required | "master+originaloccurrenceidentity beforeedit"<br>provider occurrenceprojection | Nevereditedstart; exactmaster/sourcecalendar match<br>serverconstructsoccurrenceKey preserving originalzone/date; no indexbydisplayorder | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Идентификатор исключения остаётся прежним после перемещения. |
| repeatRule · Повторение | readonly existingRRULE / reviewed domain patch / optional | "existingseriesrule"<br>provider | ArbitraryRRULE text noteditable byregisteredseriescontrol; targetruleeditor requiresowncontrol extension<br>Preserveexistingrule; don'tflattenlocal projectedoccurrences | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Этот диалог выбирает область изменения, а не создаёт новую серию. |
| offsetChoice · Какое смещение времени | earlier  /  later  /  null / optional | "null whenfold; uniqueoffset autoonlyifunique"<br>IANA resolver candidates | Required for ambiguousciviltime; nochoicefor nonexistenttime; displayedcandidateinstantstable<br>earlier/later explicitly selected→instant; gapreject | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>02:30 может встретиться дважды. Выберите показанное смещение и UTC момент. |

### Actions / typed contracts

#### Применить изменение · calendar.updateOccurrence

- Binding: WP-29.operations[calendar.updateOccurrence].
- Request schema: DF-09-SCHEMA-1.
- Input: Envelope+{event:Rox2EntityRef,occurrenceKey:string,scope:one|series|following,patch:CalendarPatchResolved}.
- Result: {eventRef,receiptId,operationState:committed|reconciling,status:CanonicalStatus,normalizedOccurrence?,splitSeriesRefs?}.
- Errors: denied, unsupported_scope, invalid_local_time, ambiguous_local_time, provider_conflict, invalid_recurrence.
- Transition: Validate fields → focus first error → fresh capability/revision → one durable intent/key → lock same form action → receipt/readback; never label queued as completed.
- Mapping: leafRecurrenceWriteScopeinstance→wireone. sourceCalendarRef+master+originalStart authorityderiveoccurrenceKey. Patch usesresolved temporalfields; don'twritewhole series whenuser choseinstance.

### Request mapping / schema amendments

- OccurrenceKey schema typed/source-scoped; patch onlyvalidated knownCalendarfields; old genericobject cannotacceptarbitrarypayload.
- No arbitraryrecurrencenewrule editor introduced; existingseries/occurrencechangeonly. Subsequent ruleform needsregisteredcontrol.

```json
{
  "status": "PROPOSED_NORMATIVE_TARGET_OVERRIDE",
  "fields": {
    "instance": "scope:one",
    "following": "scope:following",
    "series": "scope:series",
    "originalOccurrence": "sourcecalendar/master/originalStart→authorityoccurrenceKey, nevereditedstart",
    "patch": "validatedresolvedCalendarPatch"
  },
  "envelope": "workspaceId/commandId/idempotencyKey/expectedRevision separate; actor authenticatedserver",
  "rejectUnknownFields": true,
  "registrationBoundary": "Any named secondary canonical operation above is proposed registration in same authority before UI dispatch. Exact request schema and examples provided; original leaf symbol retained as adapter provenance."
}
```

- **DF-09-SCHEMA-1 / o:** REQUIRED_BEFORE_UI_DISPATCH. Exact Draft07 payloadSchema в JSON; additionalProperties=false. semanticConstraints требуют server validation. Historical Revision2 не считается доказанным target.

### Видимые состояния

- **disabled:** Провайдер не поддерживает изменение «этого и следующих» событий.
- **loading:** Изменяем выбранную область серии…
- **error:** Такого местного времени нет. Выберите другое время.
- **success:** Изменение применено к выбранной области.
- **offline:** Нет связи. Изменения сохранены в черновике; операция не подтверждена.
- **reload:** Восстановить сохранённый baseline, незавершённый intent и отдельно несохранённые поля; повторный dispatch только того же immutable intent.
- **dirtyClose:** Есть несохранённые изменения. «Продолжить редактирование» / «Сохранить черновик» / «Закрыть без сохранения». Отправленный intent закрытием не отменяется.

### Focus / keyboard / help

- **focus:** Scopefirst; no default-enter acrossdialog; ambiguousoffsetfocus; Escapeabortsentire pendingdraftsave beforedispatch.
- **keyboard:** Arrowradios; CmdCtrlEnter explicitapply afterscope+offset; IMEgate.
- **click:** Scopehelp explains exception/split/master; choosing unsupported option doesnotfallbackseries; dirtypatchretained.

Field-specific help доступен hover500ms, focus и отдельной кнопкой «Что это?», показывает смысл/единицы/source/asOf/example; не меняет значение. Ошибка aria-describedby, first invalid focus; IME/autocomplete consumes Enter.

**Permissions / provider:** calendar.event.write+provider scope capability; allDaycivilDates notfoldresolved, no24hassumption; server rechecksproviderandetag.

### Owned implementation seams

- WP-29: apps/electron/src/renderer/pages/calendar/CalendarPreferences.tsx — recurrence/time policy integration.
- WP-28: apps/electron/src/renderer/components/meetings/CalendarEventEditor.tsx — series dialog.

### Domain examples — NOT_RUN

1. **valid** {"scope": "instance", "originalStart": "2026-10-25T00:30:00Z", "newCivil": "2026-10-25T02:30", "timeZone": "Europe/Berlin", "offsetChoice": "later"} → wire scopeone, original key00:30Z retained; edited instant01:30Z; master unchanged.
2. **negative** {"scope": "following", "providerSupportsFollowing": false} → unsupported_scope; no split/serieswrite fallback.

### Machine fixtures — NOT_RUN product runtime

```json
[
  {
    "id": "DF-09-F1",
    "kind": "valid_schema",
    "canonicalOperation": "calendar.updateOccurrence",
    "schemaAmendmentId": "DF-09-SCHEMA-1",
    "payload": {
      "event": {
        "workspaceId": "ws:test",
        "entityId": "calendar-event:e1"
      },
      "occurrenceKey": "account:a/cal1/master/2026-10-25T00:30:00Z",
      "scope": "one",
      "patch": {
        "start": {
          "kind": "instant",
          "value": "2026-10-25T01:30:00Z",
          "timeZone": "Europe/Berlin"
        },
        "end": {
          "kind": "instant",
          "value": "2026-10-25T02:30:00Z",
          "timeZone": "Europe/Berlin"
        }
      }
    },
    "envelope": {
      "workspaceId": "ws:test",
      "commandId": "DF-09-intent1",
      "idempotencyKey": "DF-09-key1",
      "expectedRevision": "r7"
    },
    "expected": "Shapevalid thenACL/provider/CASsemantic validation; NOT_RUN runtime."
  },
  {
    "id": "DF-09-F2",
    "kind": "negative_schema",
    "schemaAmendmentId": "DF-09-SCHEMA-1",
    "payload": {
      "event": {
        "workspaceId": "ws:test",
        "entityId": "calendar-event:e1"
      },
      "occurrenceKey": "account:a/cal1/master/2026-10-25T00:30:00Z",
      "scope": "one",
      "patch": {
        "start": {
          "kind": "instant",
          "value": "2026-10-25T01:30:00Z",
          "timeZone": "Europe/Berlin"
        },
        "end": {
          "kind": "instant",
          "value": "2026-10-25T02:30:00Z",
          "timeZone": "Europe/Berlin"
        }
      },
      "unrecognizedMutationField": "reject"
    },
    "expectedError": "INVALID_PAYLOAD unknown field; no mutation/providercall."
  }
]
```

## DF-10 — Присоединение к звонку — устройства и auth

**Current / proposed:** Current room provider unavailable. Proposed call join uses shortlived token and real media connection; rosterpresence alone notjoinedproof.

**Layout:** Callprejoin «Микрофон»/«Камера» selectors and offdefaulttoggles, localtestpreview, «Присоединиться»; capability notice before requestingdevices.

**Screen/controls:** MTG-05 / join. **WP:** WP-31, WP-32. **Evidence:** R4-E07.

### Поля

| Field / RU label | Type / required | Default / source | Validation / coercion | Dirty / help |
|---|---|---|---|---|
| callRef · Звонок | readonly Rox2EntityRef / required | "authorizedcallcontext"<br>GetCallState | Activecall; channelmembership orscopedguestcapability; freshgrant<br>no roomIDfromuntrustedURL alone | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Используется тот же Call, открытый из Channel или Meetings. |
| microphoneEnabled · Включить микрофон | boolean / required | false<br>explicituser | Nativepermissionwhen enabled; providerpublish permission<br>Localtoggleonly; changeduringprejoin no networkpublication | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Микрофон выключен до явного выбора. |
| microphoneDevice · Микрофон | opaque deviceId  /  null / optional | "null→systemdefault whenpermissiongranted"<br>enumerateDevices afternativepermission | Currentlyavailabledevice; labelsnotavailableuntilpermission; deviceIDephemeral localonly<br>Don'tsendhardwaredeviceIDin domainbody; no persistentfingerprint | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Выберите доступное устройство. Отказ не означает, что вы вошли в звонок. |
| cameraEnabled · Включить камеру | boolean / required | false<br>explicituser | Nativepermission+callpublishvideo capability<br>Localtoggle; no cameraautostart | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Предпросмотр локальный; изображение не публикуется до подключения. |
| cameraDevice · Камера | opaque deviceId  /  null / optional | "systemdefault afterpermission"<br>localdeviceenumeration | Availabledevice; unplug/revoke errorhandled<br>localonly | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Устройство можно отключить перед входом. |
| deviceId · Это устройство ROX [immutable hidden binding] | readonly installation-scoped opaque id / required | "registeredROXdevice id"<br>authenticated client registration | Not browser media deviceId; session scopedauthorization<br>Not trusted actor identity; servervalidates deviceprincipalrelation | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Это идентификатор клиента для подключения, а не серийный номер камеры. |

### Actions / typed contracts

#### Присоединиться · call.join

- Binding: MTG-05.commands[JoinCall]; existing call authority WP31; Revision4 canonical registration=call.join owner=WP-31.
- Request schema: DF-10-SCHEMA-1.
- Input: {callRef:Rox2EntityRef,deviceId:string}.
- Result: {endpoint:https-or-wssURL,token:secret,expiresAt:RFC3339,participantRef:Rox2EntityRef} → mediaConnectResult{connected|failed,trackPublicationStates}.
- Errors: denied, revoked, media_unavailable, ended, native_permission_denied, device_unavailable.
- Transition: FreshGetCallStatecapability → localpermissions ifenabled → JoinCallminttoken → connectSFU → joinedonly actualconnection. Tokenin memoryno URL/log/persistentdraft; retrymintfresh token afterACL.

### Request mapping / schema amendments

- JoinCall named leafbinding registration required; preserveoneprincipal/callidentity. Device selections localmediaadapterinput, notnewdomainAPI.
- Nativepermissionerrors localformresult; don'tfakeprovider receipt. Guestdoesnotbecomeworkspacemember.

```json
{
  "status": "PROPOSED_NORMATIVE_TARGET_OVERRIDE",
  "fields": {
    "callRef": "callRef",
    "registeredDeviceId": "deviceId",
    "nativeMediaDeviceIds": "localadapteronly, notdomainbody",
    "toggles": "publishonlyafteractualconnection"
  },
  "envelope": "workspaceId/commandId/idempotencyKey/expectedRevision separate; actor authenticatedserver",
  "rejectUnknownFields": true,
  "registrationBoundary": "Any named secondary canonical operation above is proposed registration in same authority before UI dispatch. Exact request schema and examples provided; original leaf symbol retained as adapter provenance."
}
```

- **DF-10-SCHEMA-1 / o:** REQUIRED_BEFORE_UI_DISPATCH. Exact Draft07 payloadSchema в JSON; additionalProperties=false. semanticConstraints требуют server validation. Historical Revision2 не считается доказанным target.

### Видимые состояния

- **disabled:** Звонки пока недоступны: медиапровайдер не подключён.
- **loading:** Подключаемся к звонку…
- **error:** Нет доступа к микрофону. Разрешите доступ в настройках системы или войдите без микрофона.
- **success:** Подключено к звонку.
- **offline:** Нет связи. Изменения сохранены в черновике; операция не подтверждена.
- **reload:** Восстановить сохранённый baseline, незавершённый intent и отдельно несохранённые поля; повторный dispatch только того же immutable intent.
- **dirtyClose:** Есть несохранённые изменения. «Продолжить редактирование» / «Сохранить черновик» / «Закрыть без сохранения». Отправленный intent закрытием не отменяется.

### Focus / keyboard / help

- **focus:** Unavailable→reason/Connectionslink; ready→microphoneselector; joinfailure→error+retry; no automaticjoin onfocus.
- **keyboard:** Space toggles; Enter on joinonly; localpreviewdoesnotinterceptEscape nativepermissions; devicecomboboxEnterselect.
- **click:** Join disableswhileconnect; devicepermissioncancel mayjoinlistenonlyafterexplicitchoice; stop previewtrackswhenclose.

Field-specific help доступен hover500ms, focus и отдельной кнопкой «Что это?», показывает смысл/единицы/source/asOf/example; не меняет значение. Ошибка aria-describedby, first invalid focus; IME/autocomplete consumes Enter.

**Permissions / provider:** call.join+channelmember orguestscopedtoken; providerliveavailable; nofixture enablebutton. Tokenexpires/revokeeject requireproviderlane.

### Owned implementation seams

- WP-31: apps/electron/src/renderer/components/meetings/LiveCallView.tsx — prejoin.
- WP-32: apps/electron/src/renderer/pages/meetings/CallParticipants.tsx — participant/device state.

### Domain examples — NOT_RUN

1. **valid** {"mic": false, "camera": false, "authorized": true, "providerConnected": true} → listenonly actualroomconnected; tokennotpersisted; no mediapublish.
2. **negative** {"tokenIssued": true, "mediaConnectionFailed": true} → No «Подключено»; localpreviewtracksstopped; refreshedACLbefore retry.

### Machine fixtures — NOT_RUN product runtime

```json
[
  {
    "id": "DF-10-F1",
    "kind": "valid_schema",
    "canonicalOperation": "call.join",
    "schemaAmendmentId": "DF-10-SCHEMA-1",
    "payload": {
      "callRef": {
        "workspaceId": "ws:test",
        "entityId": "call:c1"
      },
      "deviceId": "rox-device:test"
    },
    "envelope": {
      "workspaceId": "ws:test",
      "commandId": "DF-10-intent1",
      "idempotencyKey": "DF-10-key1",
      "expectedRevision": "r7"
    },
    "expected": "Shapevalid thenACL/provider/CASsemantic validation; NOT_RUN runtime."
  },
  {
    "id": "DF-10-F2",
    "kind": "negative_schema",
    "schemaAmendmentId": "DF-10-SCHEMA-1",
    "payload": {
      "callRef": {
        "workspaceId": "ws:test",
        "entityId": "call:c1"
      },
      "deviceId": "rox-device:test",
      "unrecognizedMutationField": "reject"
    },
    "expectedError": "INVALID_PAYLOAD unknown field; no mutation/providercall."
  }
]
```

## DF-11 — Согласие на запись — точная привязка артефакта

**Current / proposed:** Consentforms propose common audienced recording/artifact binding; existing local capture not automatically uploadconsent and unavailable room notrecordable.

**Layout:** RecordingConsentDialog sourcecall/capture/artifactchecksum, visibleaudience+retention, unchecked acknowledgement; «Согласиться на запись». Provisionalbanner and explicitfinalmanifest review; revokeeffectdialog.

**Screen/controls:** MTG-06 / grant, start, revoke. **WP:** WP-33, WP-35. **Evidence:** R4-E07, R4-E08.

### Поля

| Field / RU label | Type / required | Default / source | Validation / coercion | Dirty / help |
|---|---|---|---|---|
| scope · Для чего согласие | readonly room_recording  /  local_upload / required | "openedcontrolcontext"<br>authorityroom/localrecording | Discriminatedtype; neverwildcardfuturemedia<br>No usertampering hidden switch | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Согласие действует для этого звонка или этой записи. |
| sourceBinding · Звонок или запись | readonly CallRef OR LocalRecordingHandle OR ArtifactManifest / required | "exactsource"<br>authorizedsourceproof | roomcallref; localhandle{workspaceId,deviceId,localMeetingId,captureGeneration}; finalizedartifactref+checksum64hex+revision+manifestHash64hex<br>Never deriveartifactfromfilesystemfilename; provisionalhandle cannot upload | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Новая запись или другой checksum требуют нового просмотра. |
| audiencePolicy · Кто получит доступ | readonly {ref,revision,authorizedAudienceDescription} / required | "currentauthoritypolicy"<br>policyquery | Exactcurrentrevision; readauthorizedaudienceonly; changeinvalidatesconsent<br>No arbitrary recipienttext; policyrevisionbound | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Согласие не открывает запись всем участникам автоматически. |
| retentionPolicy · Хранение | readonly {revision,duration,legalHoldExplanation?} / required | "currentpolicy"<br>authority | Versionedpolicy; no deletionguaranteeiflegalhold<br>Timeunits explicit; notgrantfromunknownretention | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Отзыв согласия не гарантирует удаления ранее опубликованной записи. |
| acknowledged · Я ознакомился с условиями этой записи | boolean / required | false<br>explicituser | Must true beforegrant; neverprechecked; textmatchesbinding/audience/retentionhash<br>Resetfalsewhensource/policychanges | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Условия привязаны к показанной версии записи. |
| inputChecksum · Checksum записи | readonly SHA256hex  /  null / optional | "nullbeforefinalization; exactfinalizedsourcechecksumafter"<br>immutablemanifest | 64hexrequiredforartifact_bound; nullonlyprovisional; serververifiesbytesmanifestrelation<br>Lowercasehexwithoutchangingdigest; can'tuseredit | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>До готового checksum загрузка в облако запрещена. |

### Actions / typed contracts

#### Согласиться на запись · consent.record

- Binding: cloud/contract-amendments.separateOperations; MTG-06.RecordConsent.
- Request schema: DF-11-SCHEMA-1.
- Input: Envelope+RecordConsentInput(room|finalLocalArtifact|localDraft).
- Result: {consentRef,revision,operationState:room_granted|provisional|artifact_bound,bindingDigest,receiptId,status:CanonicalStatus}.
- Errors: policy_stale, audience_policy_stale, source_denied, artifact_mismatch, capture_generation_mismatch, denied.
- Transition: Validate fields → focus first error → fresh capability/revision → one durable intent/key → lock same form action → receipt/readback; never label queued as completed.
#### Подтвердить эту готовую запись · consent.bindLocalUpload

- Binding: cloud supplement; MTG-06.BindLocalUploadConsent, same grantcontrol finalreview.
- Request schema: DF-11-SCHEMA-2.
- Input: Envelope+{consentRef,baseConsentRevision,localRecordingHandle,artifactRef,inputChecksum,artifactRevision,manifestHash,audiencePolicyRef,audiencePolicyRevision,retentionPolicyRevision,policyRevision}.
- Result: {consentRef,revision,bindingDigest,receiptId,operationState:artifact_bound,status:CanonicalStatus}.
- Errors: denied, consent_revoked, policy_stale, audience_policy_stale, capture_generation_mismatch, artifact_mismatch, already_bound_different_artifact.
- Transition: Validate fields → focus first error → fresh capability/revision → one durable intent/key → lock same form action → receipt/readback; never label queued as completed.
#### Начать запись звонка · call.startRecording

- Binding: WP-33.operations[call.startRecording].
- Request schema: DF-11-SCHEMA-3.
- Input: Envelope+{call,consentVersion,consentingPrincipalIds}.
- Result: {recordingRef,receiptId,operationState:starting|active,status:CanonicalStatus}.
- Errors: consent_missing, consent_stale, denied, egress_unavailable.
- Transition: Validate fields → focus first error → fresh capability/revision → one durable intent/key → lock same form action → receipt/readback; never label queued as completed.
- Mapping: consentingPrincipalIds areauthorityvalidated currentrosterconsents, not checkboxclaim. Missing requiredconsentblocks; activeonlyegressreceipt.
#### Отозвать согласие · consent.revoke

- Binding: MTG-06.commands[RevokeConsent]; Revision4 canonical registration=consent.revoke owner=WP-33.
- Request schema: DF-11-SCHEMA-4.
- Input: Envelope+{consentRef,baseRevision}.
- Result: {revision,receiptId,effect:stopping|upload_cancelled|policy_applied,status:CanonicalStatus}.
- Errors: conflict, denied.
- Transition: Validate fields → focus first error → fresh capability/revision → one durable intent/key → lock same form action → receipt/readback; never label queued as completed.

### Request mapping / schema amendments

- All payloads usecurrentleafdiscriminatedRecordConsentInput; no uniformcall-widefutureartifactconsent.
- StartRecording roster/version checkedauthority/provider; no clientattestation accepted.
- Finalbindingreview reusesgrantcontrol; finalchecksum/audiencenewversion resetsacknowledgement; workerdispatch/retry recheck bindingconsent.

```json
{
  "status": "PROPOSED_NORMATIVE_TARGET_OVERRIDE",
  "fields": {
    "room": "RoomConsentInput",
    "localDraft": "LocalDraftConsentInput→provisional",
    "finalArtifact": "exact ArtifactManifest→artifact_bound; bindLocalUploadConsent",
    "acknowledgement": "UIguard; actor/consent/roster verifiedauthority",
    "revisions": "policy/audience/retentioncurrentatdispatchandretry"
  },
  "envelope": "workspaceId/commandId/idempotencyKey/expectedRevision separate; actor authenticatedserver",
  "rejectUnknownFields": true,
  "registrationBoundary": "Any named secondary canonical operation above is proposed registration in same authority before UI dispatch. Exact request schema and examples provided; original leaf symbol retained as adapter provenance."
}
```

- **DF-11-SCHEMA-1 / grant:** REQUIRED_BEFORE_UI_DISPATCH. Exact Draft07 payloadSchema в JSON; additionalProperties=false. semanticConstraints требуют server validation. Historical Revision2 не считается доказанным target.
- **DF-11-SCHEMA-2 / bind:** REQUIRED_BEFORE_UI_DISPATCH. Exact Draft07 payloadSchema в JSON; additionalProperties=false. semanticConstraints требуют server validation. Historical Revision2 не считается доказанным target.
- **DF-11-SCHEMA-3 / start:** REQUIRED_BEFORE_UI_DISPATCH. Exact Draft07 payloadSchema в JSON; additionalProperties=false. semanticConstraints требуют server validation. Historical Revision2 не считается доказанным target.
- **DF-11-SCHEMA-4 / revoke:** REQUIRED_BEFORE_UI_DISPATCH. Exact Draft07 payloadSchema в JSON; additionalProperties=false. semanticConstraints требуют server validation. Historical Revision2 не считается доказанным target.

### Видимые состояния

- **disabled:** Ознакомьтесь с условиями и подтвердите согласие.
- **loading:** Сохраняем согласие… / Начинаем запись…
- **error:** Условия доступа изменились. Проверьте новую аудиторию и подтвердите снова.
- **success:** Согласие сохранено. / Черновое согласие: загрузка ещё запрещена. / Запись привязана к checksum.
- **offline:** Нет связи. Изменения сохранены в черновике; операция не подтверждена.
- **reload:** Восстановить сохранённый baseline, незавершённый intent и отдельно несохранённые поля; повторный dispatch только того же immutable intent.
- **dirtyClose:** Есть несохранённые изменения. «Продолжить редактирование» / «Сохранить черновик» / «Закрыть без сохранения». Отправленный intent закрытием не отменяется.

### Focus / keyboard / help

- **focus:** Dialogtitle+source thenackcheckbox; policychange liveannouncementandfocusreview; Esc cancelsunsubmittedreview only.
- **keyboard:** Tab complete terms; Space ack; Enterprimarygrant explicit; no hiddencheckbox/focusgrant.
- **click:** Helpshowschecksumsource/time/policyversion; revoke showsconcreteeffectbeforecommit; olduploadedbytesdeletionseparate.

Field-specific help доступен hover500ms, focus и отдельной кнопкой «Что это?», показывает смысл/единицы/source/asOf/example; не меняет значение. Ошибка aria-describedby, first invalid focus; IME/autocomplete consumes Enter.

**Permissions / provider:** self.consent.write; call.record+freshpolicyroster+egressready; localownerdevice receipt; nofixture/live claim. Failed uploadretainlocalbytes.

### Owned implementation seams

- WP-33: apps/electron/src/renderer/components/meetings/RecordingConsentDialog.tsx — RecordingConsentDialog.
- WP-35: apps/electron/src/main/meetings/local-upload-consent.ts — finalchecksum binding.

### Domain examples — NOT_RUN

1. **valid** {"scope": "local_upload", "captureGeneration": 7, "checksum": null, "acknowledged": true} → provisional receipt; networkuploadblocked untilfinalartifact exactbinding andexplicitreview.
2. **negative** {"consentCaptureGeneration": 7, "uploadCaptureGeneration": 8} → capture_generation_mismatch; no bytes uploaded.
3. **negative** {"grantedAudienceRevision": 4, "currentAudienceRevision": 5} → audience_policy_stale; ackreset; no dispatch/retry upload.

### Machine fixtures — NOT_RUN product runtime

```json
[
  {
    "id": "DF-11-F1",
    "kind": "valid_schema",
    "canonicalOperation": "consent.record",
    "schemaAmendmentId": "DF-11-SCHEMA-1",
    "payload": {
      "scope": "local_upload",
      "meetingRef": {
        "workspaceId": "ws:test",
        "entityId": "meeting:m1"
      },
      "localRecordingHandle": {
        "workspaceId": "ws:test",
        "deviceId": "rox-device:test",
        "localMeetingId": "local-m1",
        "captureGeneration": 7
      },
      "policyRevision": 1,
      "audiencePolicyRef": {
        "workspaceId": "ws:test",
        "entityId": "permission-policy:a1"
      },
      "audiencePolicyRevision": 4,
      "retentionPolicyRevision": 2
    },
    "envelope": {
      "workspaceId": "ws:test",
      "commandId": "DF-11-intent1",
      "idempotencyKey": "DF-11-key1",
      "expectedRevision": "r7"
    },
    "expected": "Shapevalid thenACL/provider/CASsemantic validation; NOT_RUN runtime."
  },
  {
    "id": "DF-11-F2",
    "kind": "negative_schema",
    "schemaAmendmentId": "DF-11-SCHEMA-1",
    "payload": {
      "scope": "local_upload",
      "meetingRef": {
        "workspaceId": "ws:test",
        "entityId": "meeting:m1"
      },
      "localRecordingHandle": {
        "workspaceId": "ws:test",
        "deviceId": "rox-device:test",
        "localMeetingId": "local-m1",
        "captureGeneration": 7
      },
      "policyRevision": 1,
      "audiencePolicyRef": {
        "workspaceId": "ws:test",
        "entityId": "permission-policy:a1"
      },
      "audiencePolicyRevision": 4,
      "retentionPolicyRevision": 2,
      "unrecognizedMutationField": "reject"
    },
    "expectedError": "INVALID_PAYLOAD unknown field; no mutation/providercall."
  }
]
```

## DF-12 — Архив звонка — повтор обработки конкретного артефакта

**Current / proposed:** Current localdetail audio/transcript exists and summary usesagent run. Proposed archived Call artifacts have independentstage receipts; no availablelocalsummaryclaim.

**Layout:** Archive «Запись»/«Транскрипт»/«Итоги» stagecards; failedstage «Повторить обработку» dialogshowsread-onlysourcechecksum/processorversion; recordingplayerseparate.

**Screen/controls:** MTG-07 / retry-artifact, play. **WP:** WP-34, WP-33. **Evidence:** R4-E08.

### Поля

| Field / RU label | Type / required | Default / source | Validation / coercion | Dirty / help |
|---|---|---|---|---|
| artifactRef · Источник обработки | readonly Rox2EntityRef / required | "selectedfailedstageinputartifact"<br>GetArchivedCall.artifacts | Readyownedsource; notdeleted/quarantined; sourcechecksumcurrent<br>No use CallId asRecordingId; resolveexactartifact | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Повтор не создаёт новую исходную запись. |
| inputChecksum · Checksum источника | readonly SHA256hex / required | "immutablefinalizedsourcechecksum"<br>artifactmanifest | 64hexmatchmanifest; bytesidentityverified; not UIguess<br>none | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Если файл изменился, прежнюю обработку повторять нельзя. |
| processorVersion · Версия обработчика | readonly string / required | "serveradvertisedstageprocessorversion"<br>verifiedcapabilitycatalog | Nonemptyknownversion; processorcapabilityavailable; budgetallowed<br>No free-text arbitraryprocessorcode | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Результаты могут различаться между версиями; исходные evidence spans сохраняются. |
| stage · Что повторить | readonly preview  /  transcript  /  summary / required | "selectedfailedstage"<br>artifactgraph | Retryonlyselectedfailedstage; summaryrequiresreadytranscript+citationcapability; unsupportedsummarydisabled<br>No automaticretryotherstages/rawupload | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Превью, транскрипт и итоги имеют независимые состояния. |
| offsetMs · Момент записи | integer / optional | "0 forplay; transcriptspanoffsetifselected"<br>authorizedartifact/evidencespan | 0≤offset≤mediaDurationMs; absentdurationcannotseekinvalidoffset<br>Integerparseonly; secondsUI→ms exact; no transcripttextindexguess | Compare normalized semantic value with hydrated baseline; focus/hover/help does not dirty. Keep raw invalid text separately.<br>Воспроизведение открывает тот же разрешённый артефакт. |

### Actions / typed contracts

#### Повторить обработку · artifact.retry

- Binding: MTG-07.commands[RetryArtifactJob]; same artifact jobauthority; Revision4 canonical registration=artifact.retry owner=WP-34.
- Request schema: DF-12-SCHEMA-1.
- Input: Envelope+{artifactRef,inputChecksum,processorVersion}.
- Result: {jobId,receiptId,operationState:queued,status:CanonicalStatus}.
- Errors: denied, source_deleted, budget_exceeded, processor_unavailable, checksum_mismatch.
- Transition: Validate fields → focus first error → fresh capability/revision → one durable intent/key → lock same form action → receipt/readback; never label queued as completed.
- Mapping: Dedup inputchecksum/version/stage via currentartifactgraph; distinctsummaryjob reads transcript revision, never rerunsrecordingupload. Existing leafsamecommand extendedvalidation.

### Request mapping / schema amendments

- Stage is selectedartifactgraphrelationvalidatedserver-side; don't trustclientstage to bypasssourcepermissions.
- RetryArtifactJob exacttuple validated/sourcechecksum; responsequeued neverlabelready. Source raw EvidenceSpan ids/revisions immutable; speaker corrections derivative.

```json
{
  "status": "PROPOSED_NORMATIVE_TARGET_OVERRIDE",
  "fields": {
    "artifactRef": "artifactRef",
    "checksum": "inputChecksum",
    "processorVersion": "serververified processorVersion",
    "stage": "authorityartifactgraphrelation; not arbitrarywirefield"
  },
  "envelope": "workspaceId/commandId/idempotencyKey/expectedRevision separate; actor authenticatedserver",
  "rejectUnknownFields": true,
  "registrationBoundary": "Any named secondary canonical operation above is proposed registration in same authority before UI dispatch. Exact request schema and examples provided; original leaf symbol retained as adapter provenance."
}
```

- **DF-12-SCHEMA-1 / o:** REQUIRED_BEFORE_UI_DISPATCH. Exact Draft07 payloadSchema в JSON; additionalProperties=false. semanticConstraints требуют server validation. Historical Revision2 не считается доказанным target.

### Видимые состояния

- **disabled:** Обработчик итогов недоступен. Локальный backend итогов не подтверждён.
- **loading:** Ставим обработку в очередь…
- **error:** Исходная запись удалена или недоступна. Повтор обработки невозможен.
- **success:** Обработка поставлена в очередь. Готовность ещё не подтверждена.
- **offline:** Нет связи. Изменения сохранены в черновике; операция не подтверждена.
- **reload:** Восстановить сохранённый baseline, незавершённый intent и отдельно несохранённые поля; повторный dispatch только того же immutable intent.
- **dirtyClose:** Есть несохранённые изменения. «Продолжить редактирование» / «Сохранить черновик» / «Закрыть без сохранения». Отправленный intent закрытием не отменяется.

### Focus / keyboard / help

- **focus:** Failedstagebutton→dialogsourceheading; checksumconflict→errorandrefresh; afterreceiptfocusstagecardstatus.
- **keyboard:** Enterretryonlyexplicitbutton; Spacefocusedplayer togglesplay, notformsubmit; arrowsseekwithdurationbounds.
- **click:** PlayerURLfreshauthorizedsignedremoteorlocalreadAudio; retrydoesnotshare/publishrecording. Helpprocessor source/version/freshness.

Field-specific help доступен hover500ms, focus и отдельной кнопкой «Что это?», показывает смысл/единицы/source/asOf/example; не меняет значение. Ошибка aria-describedby, first invalid focus; IME/autocomplete consumes Enter.

**Permissions / provider:** artifact.process+source.read+budget; recording.read separatelyforplay; unauthorizedmetadataredacted. Providerfixture only labelledfixture, summaryunavailable preserved.

### Owned implementation seams

- WP-34: apps/electron/src/renderer/pages/meetings/LocalMeetingDetail.tsx — archive processing states.
- WP-34: packages/shared/src/workspace-domain/meetings/evidence.ts — evidence revisions.

### Domain examples — NOT_RUN

1. **valid** {"artifactRef": "recording:r1", "inputChecksum": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "processorVersion": "stt-v1", "stage": "transcript"} → Onejobduplicatekey; statequeued thenindependentprocessingreadback; rawrecordingchecksum/bytesunchanged.
2. **negative** {"sourceDeleted": true} → source_deleted; nojob/rawreupload/no artifactreadybadge.
3. **negative** {"summaryCapability": "unavailable"} → Disabledreason; no simulatedsummary or silentstartAgentRun marketedaslocalbackend.

### Machine fixtures — NOT_RUN product runtime

```json
[
  {
    "id": "DF-12-F1",
    "kind": "valid_schema",
    "canonicalOperation": "artifact.retry",
    "schemaAmendmentId": "DF-12-SCHEMA-1",
    "payload": {
      "artifactRef": {
        "workspaceId": "ws:test",
        "entityId": "recording:r1"
      },
      "inputChecksum": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "processorVersion": "stt-v1"
    },
    "envelope": {
      "workspaceId": "ws:test",
      "commandId": "DF-12-intent1",
      "idempotencyKey": "DF-12-key1",
      "expectedRevision": "r7"
    },
    "expected": "Shapevalid thenACL/provider/CASsemantic validation; NOT_RUN runtime."
  },
  {
    "id": "DF-12-F2",
    "kind": "negative_schema",
    "schemaAmendmentId": "DF-12-SCHEMA-1",
    "payload": {
      "artifactRef": {
        "workspaceId": "ws:test",
        "entityId": "recording:r1"
      },
      "inputChecksum": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "processorVersion": "stt-v1",
      "unrecognizedMutationField": "reject"
    },
    "expectedError": "INVALID_PAYLOAD unknown field; no mutation/providercall."
  }
]
```

## Secondary canonical registrations — same authority

| Operation | Owner | Form / screen | Original leaf symbol | Schema |
|---|---|---|---|---|
| crm.linkContactCompany | WP-22 | DF-03 / CRM-04 | LinkContactCompany | DF-03-SCHEMA-1 |
| mail.saveDraft | WP-19 | DF-04 / MAIL-03 | SaveDraft | DF-04-SCHEMA-1 |
| mail.cancelScheduledSend | WP-21 | DF-05 / MAIL-04 | CancelScheduledSend | DF-05-SCHEMA-2 |
| mail.reconcileSend | WP-19 | DF-06 / MAIL-04 | GetSubmissionReceipt | DF-06-SCHEMA-1 |
| calendar.createEvent | WP-28 | DF-07 / CAL-02 | CreateCalendarEvent | DF-07-SCHEMA-2 |
| call.join | WP-31 | DF-10 / MTG-05 | JoinCall | DF-10-SCHEMA-1 |
| consent.revoke | WP-33 | DF-11 / MTG-06 | RevokeConsent | DF-11-SCHEMA-4 |
| artifact.retry | WP-34 | DF-12 / MTG-07 | RetryArtifactJob | DF-12-SCHEMA-1 |

Все secondary строки PROPOSED_REGISTRATION_REQUIRED. Parent интегрирует typed schemas/registration на существующий gateway, с теми же entities/repository/ACL/outbox. mail.reconcileSend проверяет исходную отправку и никогда не вызывает send. GetSubmissionReceipt остаётся query projection той же записи. Ни одна operation здесь не означает реализованный endpoint.

## Source evidence

| ID | Repository / SHA | Path / symbol / lines | Claim |
|---|---|---|---|
| R4-E01 | rox-one/rox-one<br>f63294ba4fffa7238b46b24e918925a313ad0b12 | [apps/electron/src/renderer/pages/extra-screens/dossier/dossier-model.ts](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/apps/electron/src/renderer/pages/extra-screens/dossier/dossier-model.ts#L19)<br>DossierEntity:19–32 | Existing Dossier entity has name/kind/org/aliases/notes/promises; no normalized company owner/revenue fields. |
| R4-E02 | rox-one/rox-one<br>f63294ba4fffa7238b46b24e918925a313ad0b12 | [apps/electron/src/renderer/pages/inbox/mail/MailPanels.tsx](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/apps/electron/src/renderer/pages/inbox/mail/MailPanels.tsx#L420)<br>MailCompose/saveDraft/send:420–495 | Existing compose serializes saving/sending and autosaves dirty draft after4000ms; new neutral receipt states are proposed. |
| R4-E03 | rox-one/rox-one<br>f63294ba4fffa7238b46b24e918925a313ad0b12 | [apps/electron/src/main/mail/mail-service.ts](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/apps/electron/src/main/mail/mail-service.ts#L64)<br>MAX_ATTACHMENT_BYTES / prepare / send:64–64 | Current per-file attachment limit25*1024*1024 bytes; preserve until policy explicitly versioned. |
| R4-E04 | rox-one/rox-one<br>f63294ba4fffa7238b46b24e918925a313ad0b12 | [apps/electron/src/main/mail/mail-service.ts](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/apps/electron/src/main/mail/mail-service.ts#L400)<br>MailService.prepare/send:400–440 | Current provider account determines From identity; local loopback server rejects external recipient send. New provider-neutral form cannot report this as delivered. |
| R4-E05 | rox-one/rox-one<br>f63294ba4fffa7238b46b24e918925a313ad0b12 | [packages/core/src/calendar/types.ts](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/core/src/calendar/types.ts#L24)<br>CalendarEvent / calendarEventIdentity:24–41 | Current event uses accountId+calendarId+remote id, numeric times, allDay/timeZone/recurrence/etag; canonical form identity retains account scope. |
| R4-E06 | rox-one/rox-one<br>f63294ba4fffa7238b46b24e918925a313ad0b12 | [packages/core/src/calendar/adapters.ts](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/core/src/calendar/adapters.ts#L109)<br>createProductionAdapter:109–118 | Production adapters return Unavailable, never fixture; provider writes stay unavailable until real adapter verification. |
| R4-E07 | rox-one/rox-one<br>f63294ba4fffa7238b46b24e918925a313ad0b12 | [packages/server-core/src/meetings/rooms.ts](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/meetings/rooms.ts#L12)<br>ROOM_PROVIDER_DECISION / joinRoom / roomCapabilityEnabled:12–43 | Current media provider null/undecided and room capability false; a Join button is not a live room. |
| R4-E08 | rox-one/rox-one<br>f63294ba4fffa7238b46b24e918925a313ad0b12 | [apps/electron/src/renderer/pages/meetings/LocalMeetingDetail.tsx](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/apps/electron/src/renderer/pages/meetings/LocalMeetingDetail.tsx#L213)<br>generateSummary:213–231 | Existing summary starts agent run; this is not proof of an available local summary backend. |

## Границы

- Company/Contact name/domain/email readonly provenance; существующие controls не объявлены несуществующим identity CRUD.
- Money exact amountMinor decimal string/null и nullableowner target normatively override historical primary fields после central schema integration; no Number coercion.
- Existing Event account/calendar binding immutable; calendar move unavailable until отдельно registered. instance→one; unsupported following blocked; fold explicit/gap rejected.
- Artifact/schema проверки не доказывают provider/device/UI results. Product E2E NOT_RUN; cloud runners не запускались.
- Parent обновляет central schemas/digest/cloud packets после freeze.
