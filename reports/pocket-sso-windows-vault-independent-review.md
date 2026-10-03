# Pocket Windows vault repair — independent source and proof review

Reviewer: `/root/review_windows_vault`. Checkout: `/Users/t/.codex/worktrees/pocket-id-sso/rox-release-20261003`. Reviewed repair: `edd669c00b3662d2aaa149dbb6ff0edf6390ae1c`; base: `debd3751ba3ff906627f237fe2e2a3aaacc05386`. Root retains push, native Windows dispatch and acceptance. Source and evidence hashes are in `pocket-sso-windows-vault-independent-review-evidence/sha256.json`.

Узкое изменение durable write соответствует Windows API контракту; consequential storage regression в review не найден. Обнаружен небольшой дефект proof-контракта и исправлен по отдельному указанию root: противоречивый успешный child receipt больше не может стать `nativeStoreRestartPassed: true`.

## Standards axis

Нарушений документированных стандартов в проверенном transport/storage/workflow diff не найдено. Изменение использует существующий store, не добавляет plaintext/fallback store, не меняет renderer/config и не требует новых пользовательских строк. Существующий компактный стиль store сохранён. В checkout отсутствует `.codegraph`; выполнен узкий поиск только по назначенным source/spec/artifacts. Этот worker провёл две оси review самостоятельно, без новых вложенных агентов.

## Spec axis: одно исправленное замечание

**[P3] Противоречивый success metadata принимался как завершённое OS proof.** До hardening `projectNativeVaultReceipt` принимал `passed: true` с отсутствующей encryption metadata, `encryptionAvailable: false`, stage `account_write`, неуспешным writable fsync и платформой другого OS. Runner затем проверял только exit 0 и projected `passed`. Синтетический контроль воспроизвёл первые четыре комбинации; дополнительный oracle с исходным frozen projector отклонил старый код. Это дефект acceptance metadata, а не доказательство утечки либо ошибки реального vault: текущий native producer сам выполняет необходимые проверки до вывода success.

Root разрешил только validator hardening и meaningful negative controls. Теперь success требует правильные phase и текущую platform, stage `complete`, `encryptionAvailable === true`, `code === null`, корректную числовую Electron version с положительным major и diagnostic writable descriptor с `opened === true`, `flushed === true`, `code === null`. Windows readonly flush failure остаётся допустимой диагностикой. Failure receipts сохраняют redacted stage/code и не требуют complete/success metadata. API позволяет явно задавать ожидаемую platform для переносимых тестов; runner по умолчанию использует `process.platform`.

Изменены только `scripts/probes/pocket-vault-diagnostics.ts`, `scripts/probes/pocket-vault-diagnostics.test.ts` и этот review/evidence. Storage implementation, native producer, workflow, config и release policy в этом дополнительном hardening не менялись.

## Durable write и внешние источники

`O_WRONLY | O_NOFOLLOW` используется без `O_TRUNC`. Порядок exclusive pending write → encrypted bytes → descriptor fsync → close → atomic rename сохранён, как и directory fsync macOS, обнуление sealed buffer и cleanup pending file. Injected EIO до rename отвергает запись и сохраняет предыдущую запись.

Первичный [Microsoft FlushFileBuffers contract](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers) независимо перечитан: handle требует GENERIC_WRITE. [Официальный libuv Windows filesystem source](https://raw.githubusercontent.com/libuv/libuv/v1.x/src/win/fs.c) связывает файловый access mode с native handle и вызывает FlushFileBuffers для fsync. Это поддерживает исправление descriptor. Старый Windows job не сохранял inner stage; причинная связь именно с его failure остаётся гипотезой до нового Windows результата.

## Независимая проверка

Runtime: `/Users/t/Projects/rox-release-20261003/apps/electron/vendor/bun/bun`, **1.3.14**, host macOS. Все тесты использовали синтетические секреты и временные файлы; реальный Electron/native app не запускался.

1. Исходный repair: `bun test` для existing store, durable-write и diagnostics — **7 pass / 0 fail, 44 assertions** (`targeted.log`).
2. Frozen actual store из base с `REVIEW_STORE_SOURCE` — ожидаемый **0 pass / 1 fail**, `ROX_SECURE_STORE_WRITE_FAILED` (`frozen-before.log`). Это Windows fsync contract seam на macOS, не Windows DPAPI proof.
3. После proof hardening — **8 pass / 0 fail, 63 assertions** (`targeted-hardened.log`). Новый oracle проверяет incomplete stage, foreign phase/platform, unavailable encryption, contradictory/missing code, missing/invalid Electron version, absent fsync, readonly-only flush, unopened writable fd и failed/error-bearing writable flush; полные write/read receipts принимаются.
4. Новый oracle на frozen projector `edd669c` — **2 pass / 1 fail**, первый пропущенный invalid platform (`validator-before-negative.log`). Frozen test сохранён с суффиксом `.fixture`, чтобы намеренно красный контроль не попал в автоматическое обнаружение тестов. `receipt-contract-control.ts` отдельно воспроизводит остальные старые malformed success варианты через frozen projector.
5. Existing synthetic runner failure/accelerated hung controls повторены до и после hardening: exit 1, redacted diagnostic receipt, отсутствие secret canary в output/receipt, удалённый временный профиль (`runner-controls*.log`). Оба synthetic executable завершены. Нормальный 30-second deadline в source сохранён; accelerated control не является native timeout proof.
6. Сохранённые actual Mac Keychain receipts от repair повторно пропущены через новый валидатор; оба native write/read success сохранены (`saved-mac-compatibility.log`). Это readback существующего evidence, не новый native запуск.
7. Workflow parsed through installed `js-yaml`: new workflow manual-only, contents read, deadline 15 min; release workflow сохраняет push + dispatch, contents read, package deadline 60 min (`workflow-readback.json`). Python YAML parser отсутствовал; recovery использовал установленную библиотеку проекта без установки зависимостей.
8. Electron project typecheck и focused strict diagnostics/test typecheck с `noUncheckedIndexedAccess` завершились exit 0 (`electron-types.log`, `proof-strict-types.log`); empty logs означают отсутствие diagnostics. `git diff --check` — pass.

Workflow удаляет local-platform checked-in receipt до install/package и загружает отдельный diagnostic artifact через `always()`. Failed/missing child proof ведёт к failed runner. Bootstrap failure до probe оставляет artifact отсутствующим; это не успешный native proof. Package wildcard может включать checked-in receipt другой платформы — root должен принимать platform-specific artifact именно нового job, с соответствующим SHA/run. Workflow metadata не доказывает выполнение теста внутри опубликованного packaged application.

## Граница acceptance и передача

Новый actual Windows before/after всё ещё **pending**. Root должен push итоговый SHA с validator hardening, dispatch workflow, прочитать новый Windows job и receipt: DPAPI/encryption available, writable fsync success, обе phase `complete`, `nativeStoreRestartPassed: true`, корректная platform/version. Затем при необходимости повторить full package на том же SHA. Никаких изменений production, push/deploy, signup, OAuth/provider/GUI acceptance этим reviewer не выполнялось.

Итог по осям: Standards — 0 замечаний; Spec — 1 небольшое замечание proof metadata, исправлено и проверено. Реальная Windows acceptance не завершена.
