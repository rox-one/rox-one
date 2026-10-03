# Pocket native vault: Windows durable-write repair

Owner: independent desktop reviewer `/root/review_desktop`; integration/push/CI owner: root. Base revision: `debd3751ba3ff906627f237fe2e2a3aaacc05386`. Source/evidence content hashes: `pocket-sso-windows-vault-repair-evidence/sha256.json`.

Реализовано узкое исправление записи OS vault: `.pending-*` файл открывается для `fsyncSync` с `O_WRONLY | O_NOFOLLOW` вместо `O_RDONLY | O_NOFOLLOW`. Сохранены exclusive `wx`, mode 0600, запись зашифрованного payload, fsync до rename, закрытие descriptor, atomic rename, отдельный directory fsync на macOS, очистка pending и обнуление encrypted buffer. Никакого fallback при ошибке flush не добавлено. Другие stores не изменены.

## Причина и граница утверждения

Исходный Windows CI job `111267895845` успешно упаковал приложение, но завершился с `native_probe_write_failed_1`. Из прежнего receipt известно только `write` + exit 1; точный stage неизвестен, поскольку старый runner не сохранял child diagnostics. Это **не** достаточное доказательство точной причины того CI сбоя.

При этом дефект исходного descriptor подтверждён первичным API контрактом: [Microsoft FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers) требует `GENERIC_WRITE`; [libuv Windows filesystem implementation](https://raw.githubusercontent.com/libuv/libuv/v1.x/src/win/fs.c) отображает `O_RDONLY` в read access, а `fsync` вызывает `FlushFileBuffers`. Поэтому read-only descriptor несовместим с Windows fsync независимо от наличия права создать файл. Связь с исходным CI failure — обоснованная гипотеза до настоящего Windows повторного запуска.

## Проверки

1. **Корректный red control:** текущий regression запущен с frozen store из base HEAD (`REVIEW_STORE_SOURCE=/tmp/pocket-account-store-readonly-before.ts`, получен через `git show`; exact snapshot сохранён как `pocket-account-store-readonly-before.ts` в evidence). Actual `createPocketAccountStore` и реальные temporary files, injected AES-GCM safeStorage и Windows write-handle contract fsync seam. Получен `ROX_SECURE_STORE_WRITE_FAILED`, 0 pass / 1 fail. Это не настоящий Windows и не DPAPI.
2. **Green:** те же реальные store paths после изменения + existing store encryption/caller isolation/symlink tests + diagnostics: **7 pass / 0 fail, 44 assertions**, Bun 1.3.14. Проверены sealed account/logout/binding recovery, отсутствие read-only flush, успешные writable flush и injected EIO: write отвергнут, предыдущий record сохранён, pending file удалён.
3. **Actual local macOS:** pinned Electron **39.2.7**, Keychain `safeStorage.isEncryptionAvailable() === true`, реальные `createPocketAccountStore` write/read через два отдельных Electron process. Account/logout/binding hashes восстановлены; account/logout очищены; временный профиль удалён runner. Native filesystem fixture отдельно открыл и flush-нул read-only и writable fd: оба успешны на macOS. Это не Windows proof и не GUI/OAuth/provider acceptance.
4. **Runner failure/timeout controls:** explicit synthetic executable в копии runner, bounded accelerated timeout. Stage `account_write`/known error сохранены, raw stdout extras и stderr secret canary не попали в report/output; hung child terminated; оба temporary profiles удалены. Это тест runner control/projection, не native encryption.
5. Electron `tsc -p apps/electron/tsconfig.json --noEmit`: exit 0. Probe strict typecheck с `noUncheckedIndexedAccess: true`: exit 0. YAML parse/readback: fast workflow только `workflow_dispatch`; existing desktop workflow сохраняет `push` на `release/desktop-*` + dispatch. Оба с contents read. `git diff --check`: pass.

Commands and results preserved under `reports/pocket-sso-windows-vault-repair-evidence/`. Основные receipts: `contract-before-corrected.log`, `targeted-after.log`, `native-mac-after.json`, `runner-failure-control.log`, `workflow-check.log`, `windows-before.json`. Empty typecheck logs mean successful exit as recorded above.

## Диагностика и CI

Native probe выводит только projected metadata: phase/platform/pinned Electron/encryption boolean/backend/stage/allowlisted code + readonly/writable fsync outcomes. Ни error message/stack/path, ни stdout/stderr extras, ни account/token values не сохраняются. Неизвестный error code становится `unknown`. Writable filesystem flush обязателен; readonly failure только diagnostic, без ослабления store security.

Runner сохраняет receipt и при nonzero/missing proof, дренирует child pipes без публикации stderr, ограничивает каждый child 30 секундами, удаляет temporary profile. Release workflow сохраняет отдельный diagnostic artifact через `always()`. Перед install/package удаляется checked-in platform receipt, чтобы bootstrap failure не загрузил старую зелёную запись.

Новый `.github/workflows/pocket-native-vault.yml` — только ручной запуск macOS 15 / Windows 2025, Bun 1.3.14, frozen lockfile с Electron 39.2.7, portable contract/diagnostic tests и actual OS vault probe. Existing synthetic macOS/symlink tests выполняются только на macOS: они принудительно вызывают macOS directory fsync. Нет packaging, публикации, OAuth, normal app configuration или окна. Артефакт — platform JSON; при failure до probe артефакт отсутствует, а старый receipt заранее удалён.

## Сохранённая история ошибок harness

- `contract-before.log`: первоначальная mock.module fixture сохраняла live namespace fs вместо snapshot и могла рекурсировать. Не считается валидным red control; исправлена snapshot-копией, затем выполнен `contract-before-corrected.log`.
- `runner-failure-control-initial.log`: ускоренный timeout применялся и к failure case, мог остановить child до receipt. Исправлено: accelerated timeout только hung case; финальный control зелёный.
- `workflow-check-initial.log` / `workflow-check-second-initial.log`: неверные assertions harness сначала считали null YAML workflow_dispatch ложным, затем требовали manual-only у существующего release workflow с заранее существующим branch push trigger. Source workflow trigger не менялся; исправлен readback check, окончательный результат в `workflow-check.log`.

## Pending acceptance и передача

Настоящий Windows before/after пока **pending**. Root должен push данного commit, dispatch `Pocket Native Vault Proof`, проверить новый SHA/run/job/platform receipt: writable fsync success, write/read complete, DPAPI available, nativeStoreRestartPassed true. Если Windows снова падает, safe stage/code позволит отделить encryption, filesystem flush и sealed record write/read. Затем root может повторить full packaging на том же revision. Этот repair не утверждает full Pocket GUI acceptance или provider/OAuth readiness. Reviewer не выполняет push, deploy или publication.
