---
rx-id: RX-DOC-0004
title: Аудит безопасности
status: active
---

# Аудит безопасности (RX-DOC-0004)

Дата: 2026-08-22. Ветка: `rox/ru-codex-navigation`. Охват: рабочее дерево репозитория и выборочная проверка истории git.
Метод: статический разбор кода с привязкой каждой находки к строке. Линтеры, тесты и тайпчек не запускались (запрещены регламентом волны).
Каждая находка содержит путь и строки, цитату кода, сценарий эксплуатации, severity и конкретное исправление. Пункты, где эксплуатация зависит от окружения, помечены «требует проверки».

## Сводная таблица

| Код | Находка | Severity | Файл | Статус |
|-----|---------|----------|------|--------|
| RX-SEC-0001 | Ключ шифрования хранилища учётных данных выводится из публично читаемых идентификаторов машины | Высокая | packages/shared/src/credentials/backends/secure-storage.ts | active |
| RX-SEC-0002 | Бэкап credentials.enc.bak создаётся без режима 0600 | Средняя | packages/shared/src/credentials/backends/secure-storage.ts | active |
| RX-SEC-0003 | Серверный токен печатается в stdout при старте сервера | Средняя | packages/server/src/index.ts | active |
| RX-SEC-0004 | SDK-сессии всегда запускаются в bypassPermissions; весь контроль инструментов — один PreToolUse-hook | Средняя | packages/shared/src/agent/claude-agent.ts | active |
| RX-SEC-0005 | Автономные задачи и восстановленные сессии молча получают allow-all по умолчанию | Средняя | packages/server-core/src/tasks/TaskRunner.ts | active |
| RX-SEC-0006 | Renderer может заставить main-процесс подключиться к произвольному серверу (invokeOnServer) | Низкая | apps/electron/src/main/index.ts | active |
| RX-SEC-0007 | Токен RPC-сервера сравнивается не за константное время | Низкая | packages/server-core/src/bootstrap/headless-start.ts | active |
| RX-SEC-0008 | Bash-инструмент запускает login-shell (-lc): sanitized env может быть дополнен профилями пользователя | Низкая | packages/session-tools-core/src/handlers/host-bash.ts | active |

Итого: **8 находок — Критично: 0, Высокая: 1, Средняя: 4, Низкая: 3.**

## Секреты, найденные ПРЯМО в рабочем дереве

**Действующих секретов не обнаружено.** Проверено:

- Сигнатурный поиск по всему дереву, включая скрытые каталоги `.github-archive/`, `.i18n-work/`, `vendor/rox-one-website/` и `dashboard.html`: паттерны `ghp_*`/`github_pat_*`, `sk-*`/`sk-ant-*`, `AKIA[0-9A-Z]{16}`, `BEGIN … PRIVATE KEY`, `xox*`, JWT `eyJhbGci…`. Все совпадения — тестовые фикстуры с заведомо фиктивными значениями (`doNotLeak`, `EXAMPLE`, `planted-must-not-reach-renderer`) либо тесты систем редактирования секретов (`redactSecrets`, `redactRegisteredSecrets`, exclusion «credential-like» в publications).
- `.env.example` (корень и `vendor/rox-one-website/.env.example`) — только пустые плейсхолдеры; единственные «значения» — замазанные строки в комментариях (`postgresql://appuser:***@…`). Файл явно требует заполнение через Infisical/1Password.
- История git: pickaxe `git log --all -S` по `ghp_`, `sk-ant-`, `AKIA`, `BEGIN PRIVATE KEY` плюс перечень всех когда-либо добавленных файлов классов `*.env*`, `.env*`, `*.pem`, `*.p12`, `*.key`, `id_rsa*`, `*credentials*`. Из чувствительных типов добавлялся только `.env.example` (коммит 5325c0f, содержимое чистое). Остальные срабатывания pickaxe — коммиты, добавляющие сам код редактирования секретов (например cafb152, fd82366), то есть артефакт метода поиска, а не утечки.

Оговорка о полноте: pickaxe покрывает перечисленные сигнатуры; побайтовый обход всех blob'ов истории не выполнялся.

## Подробности находок

### RX-SEC-0001 — Ключ шифрования учётных данных выводится из публично читаемых идентификаторов машины

Файл: `packages/shared/src/credentials/backends/secure-storage.ts:101-134` и `:369-378`. Статус: active. Задача: RX-TSK-0300.

```ts
// :105-107
const output = execSync(
  'ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID',
  { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
);
// :133-134 (fallback)
return `${userInfo().username}:${homedir()}`;
```

```ts
// :373-378
const stableMachineId = createHash('sha256')
  .update(getStableMachineId())
  .update('craft-agent-v2')
  .digest();
this.encryptionKey = pbkdf2Sync(stableMachineId, salt, PBKDF2_ITERATIONS, KEY_SIZE, 'sha256');
```

**Эксплуатация.** Мастер-ключ AES-256-GCM файла `~/.craft-agent/credentials.enc` выводится только из machine-ID (IOPlatformUUID на macOS, MachineGuid в реестре Windows, `/var/lib/dbus/machine-id` или `/etc/machine-id` на Linux) и salt, который лежит в заголовке самого файла. IOPlatformUUID читается любым непривилегированным локальным пользователем через `ioreg` без sudo; MachineGuid доступен группе Users; machine-id — world-readable. Парольной фразы нет. Значит шифрование не защищает от кода, исполняющегося от имени того же пользователя (основная угроза для desktop-приложения), и не добавляет ничего сверх файловых прав 0600; сценарий «украденный образ диска» защищён лишь частично, так как username/homedir восстановимы с самого образа.

**Severity: Высокая** — единственная содержательная защита всех сохранённых API-ключей провайдеров сводится к правам доступа к файлу.

**Исправление.** Генерировать мастер-ключ `randomBytes(32)` при первой установке и хранить его в OS-keychain (macOS Keychain / Windows DPAPI / libsecret); файловый формат оставить как переносимый резерв, но ключ брать из keychain. Вывод из machine-id удалить либо оставить только как last-resort с явным предупреждением пользователю.

### RX-SEC-0002 — Бэкап credentials.enc.bak создаётся без режима 0600

Файл: `packages/shared/src/credentials/backends/secure-storage.ts:362-365`. Статус: active. Задача: RX-TSK-0301.

```ts
const tmp = `${this.file}.tmp`;
writeFileSync(tmp, fileData, { mode: 0o600 });
renameSync(tmp, this.file);
copyFileSync(this.file, this.backupFile);
```

**Эксплуатация.** Основной файл создаётся с `mode: 0600`, но `copyFileSync` не наследует права: если `credentials.enc.bak` ещё не существует, он создаётся с `0666 & ~umask` (типично 0644). Рядом с расшифровываемым хранилищем остаётся более открытая копия. В сочетании с RX-SEC-0001 другой локальный пользователь читает `.bak` и восстанавливает ключ из публично читаемого IOPlatformUUID — полный доступ ко всем сохранённым API-ключам. *Требует проверки:* фактический umask и права родительского каталога на машинах пользователей; сам факт отсутствия mode в коде подтверждён.

**Severity: Средняя** — усиливает RX-SEC-0001 до реального межпользовательского сценария.

**Исправление.** После копирования выставлять `chmodSync(this.backupFile, 0o600)` либо копировать через `readFileSync` + `writeFileSync(…, { mode: 0o600 })`; добавить тест на права `.bak`.

### RX-SEC-0003 — Серверный токен печатается в stdout при старте

Файл: `packages/server/src/index.ts:329-330`. Статус: active. Задача: RX-TSK-0302.

```ts
console.log(`CRAFT_SERVER_URL=${instance.protocol}://${instance.host}:${instance.port}`)
console.log(`CRAFT_SERVER_TOKEN=${instance.token}`)
```

**Эксплуатация.** Этот же токен является secret подписи JWT веб-интерфейса (`packages/server-core/src/webui/http-server.ts:145-146`: «Secret used to sign JWTs — typically ROX_SERVER_TOKEN») и bearer-аутентификацией WS-RPC, через который агент исполняет команды на машине. При headless/docker/systemd-запуске stdout почти всегда попадает в журналы (journald, `docker logs`, лог-файлы); любой с правом чтения логов получает полный контроль над сервером.

**Severity: Средняя** — массовая практика сбора stdout делает утечку вероятной, но требуется локальный доступ к логам.

**Исправление.** Печатать полный токен только по явному флагу `--print-token` (интерактивный bootstrap); по умолчанию маскировать (первые 4 символа) или не печатать вовсе.

### RX-SEC-0004 — bypassPermissions как постоянный режим SDK-сессий

Файл: `packages/shared/src/agent/claude-agent.ts:1264-1267`, `:1594-1598`. Статус: active. Задача: RX-TSK-0303.

```ts
// This allows Safe Mode to properly allow read-only bash commands without SDK interference
permissionMode: 'bypassPermissions',
allowDangerouslySkipPermissions: true,
```

Комментарий в `:1594-1598`: `canUseTool` не используется, «All permission logic is handled via the PreToolUse hook instead».

**Эксплуатация.** Единственной точкой контроля инструментов становится пользовательский PreToolUse-hook. Если hook не зарегистрировался (регрессия, исключение при инициализации, рассинхронизация контракта с SDK) — subprocess Claude работает вообще без разрешений. Поведение SDK при исключении внутри hook (fail-open vs fail-closed) — *требует проверки*. Вместе с RX-SEC-0005 дефолтный путь исполнения команд — без запросов подтверждения.

**Severity: Средняя** — осознанный и задокументированный в коде трейдофф, но контроль не отказобезопасен.

**Исправление.** Fail-closed контракт: если hook-цепочка не подтвердила готовность к моменту первого tool-call — блокировать инструмент и останавливать сессию; добавить canary-проверку при старте сессии (ожидающийся вердикт hook на известный пробный вызов).

### RX-SEC-0005 — allow-all по умолчанию для автономных задач и восстановления сессий

Файл: `packages/server-core/src/tasks/TaskRunner.ts:116,371-372`; `packages/server-core/src/sessions/SessionManager.ts:2146,2373-2380`. Статус: active. Задача: RX-TSK-0304.

```ts
// TaskRunner.ts:116
const AUTONOMOUS_DEFAULT_MODE = 'allow-all' as const;
// TaskRunner.ts:371-372
permissionMode: node.permissionMode ?? this.spec.defaults?.permissionMode ?? AUTONOMOUS_DEFAULT_MODE,
// SessionManager.ts:2146 (restore)
permissionMode: 'allow-all',
```

**Эксплуатация.** Рукописный spec задачи без явного `defaults.permissionMode` молча получает полное исполнение команд без подтверждений; задача, запущенная автоматизацией по расписанию, превращает это в неконтролируемое исполнение на машине. Комментарий в коде объясняет выбор (режим `ask` вызывает зависание дочерней сессии, `safe` — молчаливый нулевой результат), однако безопасный дефолт должен выбираться явно автором задачи, а не подставляться незаметно.

**Severity: Средняя** — поведение документировано в коде, но пользователь не информируется о факте эскалации.

**Исправление.** Валидация при `saveTaskSpec`: отсутствие `defaults.permissionMode` — ошибка создания задачи (явный выбор в UI); при восстановлении сессии показывать индикатор активного режима.

### RX-SEC-0006 — Renderer управляет исходящими соединениями main-процесса (invokeOnServer)

Файл: `apps/electron/src/main/index.ts:864-868`; мост: `apps/electron/src/preload/bootstrap.ts:463-464`. Статус: active. Задача: RX-TSK-0305.

```ts
ipcMain.handle('server:invokeOnServer', async (_event, url: string, token: string, channel: string, ...args: unknown[]) => {
  const { connectToRemote } = await import('./handlers/workspace')
  const { client, error } = await connectToRemote(url, token)
```

**Эксплуатация.** Скомпрометированный рендерер (XSS в UI, вредоносный контент surfaces) вызывает `electronAPI.invokeOnServer` с произвольным URL — main-процесс устанавливает WS-соединение куда угодно: SSRF во внутреннюю сеть (loopback-порты соседних сервисов) и исходящий канал на контролируемую атакующим точку с произвольными channel/args.

**Severity: Низкая** — требуется уже состоявшаяся компрометация рендерера; рендерер изолирован (contextIsolation:true, nodeIntegration:false).

**Исправление.** Egress-политика для канала: whitelist схем (`ws://`/`wss://`), запрет loopback/link-local адресов кроме явно разрешённых, запрос подтверждения пользователя при первом подключении к новому host (по аналогии с SSH-hostами).

### RX-SEC-0007 — Сравнение токена не за константное время

Файл: `packages/server-core/src/bootstrap/headless-start.ts:407-408`. Статус: active. Задача: RX-TSK-0306.

```ts
requireAuth: true,
validateToken: async (t) => t === serverToken,
```

**Эксплуатация.** Обычное строковое сравнение допускает измерение времени ответа на handshake (timing side-channel). Практическая эксплуатация против токена высокой энтропии (`validateTokenEntropy` на `:372`) нереалистична, но стоимость исправления близка к нулю.

**Severity: Низкая.** **Исправление:** `timingSafeEqual(sha256(t), sha256(serverToken))` — сравнение дайджестов устраняет и проблему длины.

### RX-SEC-0008 — Login-shell в bash-инструменте дополняет sanitized env профилями

Файл: `packages/session-tools-core/src/handlers/host-bash.ts:44-49,108`. Статус: active. Задача: RX-TSK-0307.

```ts
function resolveShell(): { command: string; argsPrefix: string[] } {
  if (process.platform === 'win32') {
    return { command: 'bash', argsPrefix: ['-lc'] };
  }
  return { command: '/bin/bash', argsPrefix: ['-lc'] };
}
```

```ts
const child = spawn(shell.command, [...shell.argsPrefix, command], { cwd, env /* … */ });
```

**Эксплуатация.** Окружение санитизируется (`createSanitizedEnv()`, удаление учётных данных), но флаг `-l` заставляет bash прочитать `/etc/profile`, `~/.bash_profile` и пр. уже после санитизации: профиль может переопределить `PATH` (перехват вызова утилит командой агента) или вернуть чувствительные переменные. Сам спавн идёт массивом аргументов без `shell: true` — классической shell-инъекции на границе нет. *Требует проверки:* состав профилей на целевых машинах.

**Severity: Низкая.** **Исправление:** использовать `bash -c` без `-l` и зафиксировать `PATH` константой; либо повторно применять санитизацию после загрузки профиля.

## Работающие контроли (подтверждено)

- Привязка к нелокальному адресу без TLS блокируется без явного `--allow-insecure-bind` (`packages/server/src/index.ts:335-355`).
- WS-аутентификация: `requireAuth: true`, проверка энтропии токена, токен передаётся первым envelope-сообщением, а не в query-string (`headless-start.ts:367-409`, `transport/server.ts:431-449`).
- Веб-интерфейс: argon2id, JWT (jose), cookie `HttpOnly; SameSite=Strict`, rate-limiter на вход (`webui/auth.ts:58-70,109-111`); CORS-заголовки не выдаются (cross-origin чтения запрещены по умолчанию).
- Electron: везде `contextIsolation: true`, `nodeIntegration: false`; внешние URL проходят классификатор опасности; `setWindowOpenHandler` всегда `deny` + `openExternal`; `will-navigate` ограничен shell приложения (`window-manager.ts:127-161,305-322`). Запись файлов renderer-ом идёт через системный диалог подтверждения (`index.ts:609-634`).
- Каталог расширений: обязательная проверка ed25519-подписи и sha256-sidecar, в том числе для remote-каталога (`marketplace/catalog-signing.ts:18-41`, `marketplace/catalog.ts:128,533-537`).
- Toolchain-загрузчик: потоковый sha256 против pinned-манифеста, атомарный rename, класс ShaMismatchError (`shared/src/toolchain/downloader.ts:90-131`); генератор пинов `scripts/toolchain-locks.ts`.
- Редактирование секретов в логах/памяти: `redactSecrets`, `redactRegisteredSecrets`, exclusion credential-like с хранением только хеша фрагмента (`core/src/knowledge/publications.ts:44-48`).
- Постустановочных скриптов в зависимостях нет: единственный lifecycle-скрипт — корневой `prepare: husky` (dev-only).
- IPC: канал `__get-ws-token` и capability-мосты работают по фиксированному набору каналов; `scripts/check-raw-sends.sh` из задания в репозитории отсутствует (проверено) — контроль оценен напрямую по preload/main-коду.

## План усиления

Очередь 1 — немедленно:

1. RX-TSK-0300 (RX-SEC-0001): мастер-ключ в OS-keychain вместо вывода из machine-id.
2. RX-TSK-0301 (RX-SEC-0002): `chmod 0600` для `credentials.enc.bak` — однострочный фикс + тест.
3. RX-TSK-0302 (RX-SEC-0003): убрать печать `CRAFT_SERVER_TOKEN` в stdout по умолчанию.

Очередь 2 — эта неделя:

4. RX-TSK-0303 (RX-SEC-0004): fail-closed контракт PreToolUse + canary-проверка при старте сессии.
5. RX-TSK-0304 (RX-SEC-0005): явный `permissionMode` обязателен в task-spec, индикатор режима при restore.

Очередь 3 — бэклог:

6. RX-TSK-0305 (RX-SEC-0006): egress-политика для `server:invokeOnServer`.
7. RX-TSK-0306 (RX-SEC-0007): `timingSafeEqual` для validateToken.
8. RX-TSK-0307 (RX-SEC-0008): `bash -lc` → `bash -c` с фиксированным PATH.

## Охват и ограничения аудита

- Аудит статический; линтеры, тесты и тайпчек не запускались (ограничение волны).
- История git покрыта pickaxe по 4 сигнатурам и списком добавленных файлов чувствительных типов; полный обход blob'ов не выполнялся.
- `vendor/rox-one-website/` просмотрен сигнатурно, не построчно; `apps/ios` и messaging-workers (Discord/WhatsApp) вне глубкого охвата этой волны.
- Скрытые каталоги `.github-archive/` (метаданные upstream PR/issues craft-agents-oss) и `.i18n-work/` проверены сигнатурами — секретов нет.
