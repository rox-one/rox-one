# Программа «ROX Platform Next» — реестр требований, волны и доступы (2026-10-09)

Владелец: заказчик (голосовое ТЗ 2026-10-09). Исполнитель: агент-оркестратор + параллельные агенты.
База: `origin/main` `411978a3a`; рабочая ветка `feat/rox-platform-20261009` (worktree `archive/rox-int2`).
Статус: **В РАБОТЕ**. Волна 1 запущена (12 агентов); этот документ — единый реестр, приёмка по каждому пункту отдельно.

---

## 0. Что уже сделано и проверено (факты репо, не заявления)

| Область | Состояние | Доказательство |
|---|---|---|
| Почта `handle@rox.one` (Stalwart на TestCT, worker → mailhook → JMAP) | РАБОТАЕТ E2E | `mail.rox.one/api/health` ok; входящее `hello@conation.dev`→ящик; исходящее через Resend `delivery.delivered` |
| Тонкий фокус (1px ring, color-mix 55%) | РЕАЛИЗОВАНО | `packages/ui/src/styles/index.css:92,146-148,652-657` |
| Пилюли режимов на всех поверхностях | РЕАЛИЗОВАНО | `ModeBar` в `TopBar.tsx:176-178` (`showModePill = !isCompact`), `modes-seed.ts` |
| Разделитель панелей 8px/1px/24px + Pin сайдбара | РЕАЛИЗОВАНО | `tokens/chrome.css:41-43`, `ResizeHandle.tsx` |
| Табы встреч внутри модуля (Календарь/Встречи/Звонки/Досье/Решения) | РЕАЛИЗОВАНО (Звонки — «Скоро») | `PlanWorkspacePage.tsx:23-91` |
| Поверхность «Секреты» (Infisical-аккаунт + refs) | РЕАЛИЗОВАНО | `pages/extra-screens/secrets/SecretsPage.tsx` |
| Имя из Rox-аккаунта, баланс `availableRox`, «Аналитика продукта» ON по умолчанию | РЕАЛИЗОВАНО | `profile-strip-account.ts:12-24`; `gamification/storage.ts:83-96` |
| Pocket SSO device v2 (app→browser→app), PKCE, тома-снапшот | СЛИТО (#1453) | `docs/pocket-sso/spec.md`, `rox-pocket-client.ts` |
| Импорт паролей из браузера | ТОЛЬКО ИМПОРТ (запечатано, без чтения) | `profile-native-credentials.ts:148-232` |
| Календарь | ЛОКАЛЬНЫЙ; все провайдеры disabled | `CalendarStatusStrip.tsx`, `adapters.ts:112-139` |
| Веб-клиент (`apps/webui`) + `cloud-gateway` | Есть, но с общим паролем/общим bearer | `server-core/src/webui/*`, `cloud-gateway/src/index.ts:25-34` |
| Drive (квоты/леджер/загрузки) | ТОЛЬКО НА ВЕТКЕ PR #1626 (красный) | `packages/core/src/drive/*` (branch), `516-drive-quota.sql` уже в main |
| PostHog/OTel | ОТСУТСТВУЮТ (Sentry — единственный egress) | `main/index.ts:24,36-64` |

---

## 1. Реестр требований заказчика (2026-10-09)

Легенда: ✅ сделано · 🟡 частично · 🔴 отсутствует · ⏳ в волне 1 · ❓ нужен ответ/доступ.

| # | Требование | Состояние | Куда |
|---|---|---|---|
| R1 | Почта: 1 ГБ на пользователя по умолчанию, хранение на TestCT | 🔴 (quotaBytes не прокинут) | ⏳ MailQuota |
| R2 | Ящик выдаётся автоматически при регистрации (не при первом открытии) | 🔴 (клиентская выдача, loopback-guard) | волна 2 (сайт-хук) + ⏳ MailQuota |
| R3 | Ящик на юзернейм (уникальный) + на номер телефона | 🔴 (алиасов нет вовсе) | волна 2/3 (site + Stalwart alias) |
| R4 | Регистрация/вход по телефону через Telegram-бота (поделиться контактом) | ✅ сайт: `/login` → бот → контакт → сессия, без кода; демон владеет ботом на CT101 | — |
| R5 | Ответ: лимиты Resend free | — | см. §5 |
| R6 | Google Calendar интеграция (sync) | 🔴 | ⏳ GCalAdapter ❓ OAuth client |
| R7 | Google Drive импорт файлов в наш диск | ✅ (волна 4: провайдер `packages/shared/src/drive/importers/providers/google-drive.ts`, PR #1635; OAuth-клиент создан, приёмник — self-hosted S3) | — |
| R8 | Apple Calendar синхронизация | 🟡 (RPC-проводка готова: каналы `calendar:appleStatus/Connect/Disconnect/Sync` `LOCAL_ONLY`, серверный хендлер `calendar-apple.ts` читает EventKit-хелпер, `AppleCalendarAdapter` read-only, чип Apple Calendar в UI, локали ×12; остаётся ручной E2E: сборка Swift-хелпера → `APPLE_CALENDAR_LIVE=1` → разрешение на Календари) | волна 3 (native helper) |
| R9 | Импорт из OneDrive / iCloud / Яндекс Диска | ✅ код (волна 4, PR #1635: OneDrive/Яндекс + честный iCloud-unsupported); OneDrive/Яндекс ждут регистраций приложений — issue #1727 | — |
| R10 | Аналитика: ON по умолчанию | ✅ | — |
| R11 | Свой хостинг аналитики: PostHog + OpenTelemetry (`posthog.rox.one`, `otel.rox.one`), флаги, русский, быстро | ✅ хостинг и клиент (волна 2: `posthog.rox.one` отвечает, клиент `packages/shared/src/telemetry/posthog.ts`, OTel-коллектор); остаётся решение по стоимости VM (§5) | — |
| R12 | ROX Keeper (переименованный и нативный Infisical): пароли, sharing, папки/проекты, приглашения, TOTP/2FA/passkey, Touch ID, CLI/MCP | 🟡 (только импорт+запечатывание) | ⏳ KeeperCore (личное хранилище) → волна 2 (орг-шаринг, CLI/MCP) |
| R13 | ROX Drive/Space: 1 ТБ отображение, все данные приложения там | 🟡 (1 ТБ-метр `DriveQuotaMeter` + `DRIVE_DEFAULT_QUOTA_BYTES` = 1 ТиБ с ссылкой на спеку; секция «Данные приложения» `DriveAppDataSection` + инвентарь `packages/shared/src/drive/app-data.ts` с честными состояниями — что уже в Drive, что по требованию, что не бэкапится; локали ×12) | ⏳ зеркалирование собственного каталога приложения (workspaces/сессии/настройки/Keeper) в Drive — нет движка (бэкенд) |
| R14 | Тайлы: «Настроить бэкап устройства» / «Импорт из Google Drive» / «Импорт из других хранилищ» | 🔴 | ⏳ DriveSurface |
| R15 | Импорт в 8 параллельных потоков, стабильно, с возобновлением | ✅ (8 потоков по умолчанию, резюмируемый runner, retry, guard циклов) | — |
| R16 | Веб-версия: 2 режима (быстрый чат / облачная ВМ), доступна сразу, кнопки «Продолжить в веб»/«Перейти в приложение» | 🟢 (auth — сессии Rox ID; лендинг + кнопки; **веб-поверхность запусков в репо**: список/«Новый запуск»/отмена + открытие `cloud-run/{id}` — `apps/webui/src/cloud-vm-surface.tsx`, PR #1731) | подключение провайдера на хосте (ключ) — по готовности CT104/провайдера |
| R17 | Экран регистрации: юзернейм 4–16 `[a-z0-9_-]`, организация `username_org`, зелёные адреса, монеты | 🟡 (валидация старая 1–80, уникальности нет) | ⏳ OnboardIdentity + волна 2 (сервер) |
| R18 | Анкета: 2 колонки, бабблы 7×15 адаптивные, языки «Авто», карта часовых поясов, «А предложи сам?» | 🔴 | ⏳ OnboardQuestionnaire |
| R19 | Колонка разрешений (macOS/Windows, галочки по умолчанию, гейт Full Disk Access) | 🔴 | ⏳ OnboardPermissions |
| R20 | Геймификация: монеты за действия (+5/+5/+15/+5), +50 за полное прохождение, анимации; кривая освоения; PostHog/Sentry/Jam | 🔴 (квесты есть, ничего не отправляется) | волна 2 (леджер на сайте) + ⏳ AnalyticsSdk |
| R21 | Тема: без выбора темы (единая, фиксированная); «дефолтный дизайн должен быть другой» | 🟡 (выбор темы есть в настройках) | ❓ уточнить, какой дефолт нужен |

---

## 2. Волна 1 (запущена 2026-10-09, 12 агентов)

| Пакет | Что делает | Приёмка |
|---|---|---|
| MailQuota | 1 ГБ квота: `provisionMailbox(quotaBytes)` → Stalwart `maxDiskQuota`, rox-maild API + env, статус в UI | unit + bounds + honest usage |
| OnboardIdentity | Юзернейм/организация, валидация, проверка доступности (`onboarding:checkHandle`), зелёные адреса, монеты, кнопки TG/GitHub | таблица валидации, state machine, «unknown» без обмана |
| OnboardQuestionnaire | Шаг «profile»: поля, бабблы 7×15, адаптив, «А предложи сам?», кнопки Continue/Skip | тесты каталога/адаптива/гейта |
| OnboardPermissions | Колонка разрешений + честные статусы ОС + гейт Full Disk Access | mappings, feedback |
| KeeperCore | Личное хранилище: модель, шифрование safeStorage, CRUD, reveal, TOTP, импорт браузерных паролей, UI «Секреты» | crypto+TOTP+reveal-гейтинг |
| DriveSurface | Поверхность Drive: 1 ТБ, тайлы, локальный движок, 8 параллельных частей, resume | planner/resume/ledger |
| AnalyticsSdk | PostHog-capture + флаги (fetch, без зависимостей) + OTLP-трейсы, гейт согласия | consent-off → 0 запросов |
| TelegramLink | Сервис `services/rox-tg-linkd` + диалог в приложении (8-значный код, 30 мин) | TTL/лимиты/UI-состояния |
| GCalAdapter | Google Calendar adapter за моделью адаптеров + честный «нет клиента» | фикстуры/refresh-fail |
| PocketIdFix | Починить `id.rox.one` (Pocket ID) | 200 + OIDC discovery |
| OtelDeploy | OTel-коллектор на TestCT + `otel.rox.one` + мемо по PostHog | тестовый спан принят |
| SiteRecon | Карта rox-one-website (Better Auth, device v2, кошелёк, хук почты, деплой) | путь-доказательства |

Волна 2 (сайт + интеграции): авто-выдача ящика при регистрации, `handle availability`, серверный леджер монет, кнопки после регистрации, SSO-включение, орг-шаринг Keeper, импортёры облаков, веб-быстрый-чат.
Волна 3 (инфра/нативные): хостинг PostHog, Apple Calendar helper, CLI/MCP Keeper, Sentry/Jam, S3-движок Drive (self-hosted SeaweedFS, бакет `rox-drive`).

---

## 3. Карта полезного использования сервисов

| Сервис | Куда применяем | Ценность |
|---|---|---|
| Cloudflare Workers | вход почты (уже), `rox-one-router`, будущие вебхуки | единый внешний контур |
| Cloudflare Tunnel (cloudflared) | `mail.rox.one`, `mailhook.rox.one`, новое `otel.rox.one` | публикация без открытых портов |
| Self-hosted S3 (SeaweedFS, хост `sw`) | бэкенд Drive — бакет `rox-drive` через `https://s3.rox.one` (вместо Cloudflare R2, решение владельца 2026-10-09) | объектное хранилище, S3-совместимо |
| Cloudflare DNS | `posthog.rox.one`, `otel.rox.one`, прочее | управляемо токеном уже сейчас |
| Queues/Workflows/DO | импортёры Drive (волна 2), фоновые задания | надёжность без сервера |
| Hyperdrive | подключение Workers к существующему Postgres | управление соединениями |
| Vectorize / pgvector | корпус знаний пользователя (волна 3) | семантический поиск |
| GCP (есть аккаунт) | Cloud Run для импортёров (опция), Secret Manager | бесплатные квоты |
| TestCT | почта (есть), OTel-коллектор (волна 1), прокси Deepgram (волна 2) | уже используется |
| butovo (Proxmox) | кандидат под PostHog-хост (16–32 ГБ) | self-host аналитики |

---

## 4. Что нужно от заказчика (доступы и решения)

1. **Telegram-бот**: ✅ получено — `@rox_one_bot`, токен в секретах (§7.7); десктоп-линковка работает на локальном `rox-tg-linkd` (§7.8). Для виджета на сайте остаётся одно действие владельца: в @BotFather выполнить `/setdomain` → `@rox_one_bot` → `rox.one` (без этого официальный виджет показывает «Bot domain invalid»). Телефон владельца не нужен.
2. **Google OAuth client** (проект есть): `client_id`/`client_secret` для десктопа (PKCE, redirect на локальный порт). Область: `calendar.events` (sensitive) + `drive.file` (не restricted). Пока — режим Testing, до 100 тестовых пользователей; затем верификация (§5).
3. **PostHog**: TestCT не тянет self-host (нужно ≥16 ГБ RAM). Варианты: (а) PostHog Cloud free (1 млн событий/мес) — быстро, 0 инфры; (б) отдельный хост 16–32 ГБ (butovo/GCE) под self-host. Нужно решение; OTel-коллектор ставим уже сейчас.
4. **Sentry**: ❌ закрыто решением владельца (2026-10-09) — интеграция удалена из обоих репозиториев (§7.9), DSN не нужен. **Jam**: ✅ получен и доставлен (§7.7/§7.8).
5. **Объектное хранилище Drive**: ✅ закрыто решением владельца (2026-10-09) — self-hosted S3 (SeaweedFS) на хосте `sw`, бакет `rox-drive`, публичный `https://s3.rox.one`; Cloudflare R2 не включаем. Ранбук и переменные `ROX_DRIVE_S3_*` — `docs/drive-object-storage.md`.
6. **Векторный корпус** (волна 3): pgvector в существующем Postgres vs Cloudflare Vectorize — нужен выбор и доступ.
7. **GitHub-линковка**: сейчас есть device-flow для импорта. Для «Привязать GitHub» — либо он же (без нового приложения), либо OAuth App (`client_id`). Подтвердить.
8. **Почта**: подтвердить 1 ГБ/юзер и хранение на TestCT (диск 98 ГБ, ~38 ГБ свободно → ~30–40 полных ящиков; при росте — расширение диска).
9. **Тема/дизайн**: «дефолтный дизайн должен быть другой» — уточнить, какой именно (светлая? другой акцент?); сейчас дефолт — тёмная.
10. **Веб-режимы**: для «продолжить в веб» нужен выпуск пользовательской сессии на сайте (сейчас webui с общим паролем, cloud-gateway — общий bearer; решение «JWT позже» зафиксировано в `plans/next-program/decisions/003-cloud-runs-auth.md`). Подтвердить, что делаем пользовательскую авторизацию веба в волне 2.

---

## 5. Ответы на прямые вопросы

**Лимиты Resend (бесплатный тариф)**: 100 писем в день, 3 000 в месяц, 1 домен; входящие письма тоже считаются. Для «всех пользователей» при регистрациях нужен платный тариф (Pro от $20/мес → 50 000 писем/мес). Домен `rox.one` уже верифицирован, отправка идёт через него.

**Что такое «верификация» Google**: приложение запрашивает «чувствительные» (календарь) и «ограниченные» (полный Drive) scope — Google требует ревью: подтверждение владения доменом, политика конфиденциальности, описание использования, демо-видео; для ограниченных — платный аудит безопасности CASA (ежегодно). Пока статус Testing — до 100 тестовых пользователей без ревью. Поэтому в реализации используем `calendar.events` + `drive.file` (файлы, которые выбрал пользователь) — это исключает CASA. План: сейчас Testing → параллельно готовим верификацию к публичному запуску.

**PostHog на TestCT**: нельзя (8 ГБ RAM против ≥16 ГБ минимума; ClickHouse+Kafka съедят почту). OTel-коллектор — можно и делаем; PostHog — по варианту (а)/(б) из §4.3.

---

## 6. Риски

- `id.rox.one` (Pocket ID) не отвечал — чиним в волне 1; блокирует «всегда залогинен» и passkey-сценарий.
- Сайт задеплоен с «pocket-sso-off» — включение SSO для веба — отдельная проверяемая операция (волна 2).
- PostHog self-host требует отдельного хоста — не разворачиваем на почтовом контейнере.
- Секреты (Telegram, Google, Sentry) — только через хранилище; ключ Deepgram в клиенте переводим на серверный прокси (волна 2).
- Диск TestCT 98 ГБ: 1 ГБ/юзер почты + Drive-бэкапы требуют контроля и, при необходимости, расширения.

---

## 7. Статус выполнения (обновление 2026-10-09)

### 7.1 Сайт (rox-one-website) — СДЕЛАНО и ЗАКОММИЧЕНО
- Коммит `c033e1c` (ветка `codex/pocket-id-sso-website`, запушен): выдача ящика при регистрации через outbox (`kind='mailbox'`) + drain → `rox-maild /api/provision` (Bearera `ROX_MAIL_PROVISION_TOKEN`, квота 1 ГиБ, `ownerUuid`, `operationId`; skip-состояние без токена честное); `GET /api/handle/availability` (`available|taken|reserved|invalid`, работает независимо от `POCKET_SSO_ENABLED`; в правилах хендлов разрешён дефис); монеты `rox_award_claims` + `onboarding_award` (exactly-once, +5/+5; `awardTelegram/awardGithub` готовы); кнопки «Продолжить в веб» → `/account/overview` и «Перейти в приложение» → `rox://` с фолбэком на `/download`.
- Проверки: turbo typecheck 7/7; целевые тесты 47/47; миграции `03-mail-provision.sql`, `04-award-claims.sql` (аддитивные).

### 7.2 Инфра — СДЕЛАНО/ИЗМЕРЕНО
- `id.rox.one` = 200 (исправлено параллельной сессией владельца: cloudflared ingress `id.rox.one → 127.0.0.1:8443` + CF CNAME на тоннель `a026bef2…`). Причина простоя: проксированный origin был мёртвым AWS `44.212.103.96` + остановленный тоннель. OIDC issuer остаётся `pocketid.rox.one` — для перехода нужен доступ к CT104 (Skynet): root-ключ или Proxmox API-токен (butovo `192.168.1.71:8006` доступен, токена нет).
- OTel-коллектор на TestCT: `/opt/rox-otel` (otel-contrib 0.115.1, `network_mode: host` — важно: docker bridge на CT106 сломан), `otel.rox.one` → тоннель TestCT, приём спана подтверждён (`POST /v1/traces` → 200, запись в debug-логе). Риск: публичный OTLP без аутентификации — добавить Cloudflare Access/токен.
- PostHog: на TestCT нельзя (8 ГБ RAM < 16 ГБ минимум + сломанный bridge). Измеренные кандидаты: **rox-analytics (GCP e2-standard-4, 16 ГБ, 65 ГБ свободно)** — минимум проходит и уже целевой хост параллельной сессии (`posthog.rox.one → 34.65.70.253`); sw (12 ГБ) — мало; для >100k событий/мес — e2-standard-8 (8/32/200). butovo — не наблюдаем (нет доступа).

### 7.3 Коллизия параллельных сессий (нужна арбитрация владельца)
В worktree `rox-int2` одновременно пишет вторая сессия владельца (собственный онбординг: IdentityStep/QuestionnaireStep/CoinsBurst/learning-curve/блокировка темы/Apple Calendar helper; собственная Keeper-поверхность на Infisical-fabric). В онбординге сосуществуют две реализации; тестовый набор онбординга в смешанном состоянии (153 pass / 19 fail). Слияние i18n-фрагментов, дедупликация и общий typecheck приостановлены до решения владельца (варианты A/B/C — в отчёте сессии).

### 7.4 Готовые модули десктопа (в дереве, до интеграции)
Почта 1 ГиБ (40 тестов) · онбординг-идентичность + канал `onboarding:checkHandle` (37) · разрешения (реальные пробы macOS + каналы) · анкета/Step (32+7) · Keeper: личное хранилище `packages/shared/src/keeper/*` + `keeper:*` каналы + UI (crypto/TOTP/store тесты) · Drive: локальный движок, 8 параллельных частей, resume, страница с тайлами (30) · аналитика: `packages/shared/src/telemetry/*` (PostHog+OTLP, гейт согласия, 23) · Google Calendar: `providers/google.ts` + брокер (20) · Telegram-сервис `services/rox-tg-linkd` (в работе у агента).

### 7.5 Интеграция выполнена (2026-10-09, ~03:55 UTC+3)
- **Коммит `71d2b903b`** (ветка `feat/rox-platform-20261009`, запушен): союз обеих параллельных волн — 158 файлов; рабочее дерево чистое.
- Гейты: **`typecheck:all` — 0 ошибок** (все пакеты, включая ui/workspace-service); целевые сюиты модулей — **166/166** в одном прогоне; **i18n parity OK** (9991 ключ × 11 локалей, отсортировано); **0 неклассифицированных каналов** в routing.ts; `ipc-channels` и `channel-map-parity` — зелёные.
- Осталось 2 конфликтных теста (пересечение двух реализаций онбординга; ждут решения владельца):
  `onboarding/__tests__/identity-step.test.tsx` (1 — `onAvailabilityChecked` не вызывается) и
  `onboarding/__tests__/OnboardingWizard.test.tsx` (1 — welcome-шаг всё ещё рендерит поле юзернейма из моей реализации, тогда как тест параллельной сессии ожидает, что identity живёт только в её `IdentityStep`).
- Дубли, требующие выбора (не удалены): календарь — мой `providers/google.ts` — живой путь (`calendar:googleSync`), альтернативный `google-calendar-adapter.ts` параллельной сессии оставлен; Keeper — мой vault подключён в «Секретах», компоненты параллельной сессии (`KeeperItemsPane` и др.) сохранены без проводки.
### 7.6 Слияние онбординга — решение и волна 3 (2026-10-09 ~05:00)
Владелец делегировал решение («merge onboarding in some smart way… остальное решай сам»). Выбран единый поток **welcome → questionnaire → гейты**; legacy-шаги `identity` (IdentityStep) и `profile` (ProfileStep + `profile-permissions/*`) удаляются вместе с дублирующими моделями, компонентами и тестами.

**Остаются (живые поверхности):** WelcomeStep — сбор username/организации (4–16 и 4–32, latin/цифры/`_`/`-`, доступность, адреса `rox.one/@…`, `username@rox.one`, монеты +5/+5/+15/+5, реальные Telegram-диалог и GitHub device-flow); QuestionnaireStep — две колонки (ProfileQuestionnaireColumn + InterestBubbles слева; PermissionsColumn справа) с RewardLedger, CoinsBurst и бонусом +50 за первое прохождение целиком; PermissionsColumn + permissions-model.

**Добавляется из «мёртвых» реализаций (объединение):** реальные статусы разрешений — IPC-каналы `onboarding:permissionsStatus` / `onboarding:openPermissionSettings` уже зарегистрированы в main (server-core handler + `createOnboardingPermissionsHost`), волна 3 открывает их рендереру (channel-map + типы) и подключает к колонке: честные статусы granted/denied/not-determined/unsupported, рабочая кнопка «Выдать» → системные настройки, пере-опрос после выдачи.

**Проверка:** канонический раннер `bun run test --filter onboarding` (изоляция каждого файла) — 31/32 до волны; единственный красный тест принадлежал удаляемому legacy-компоненту. Прогон папки в одном процессе (`bun test <dir>`) не является гейтом: `mock.module` утекает между файлами.

### 7.7 Доступы и ключи (получено от владельца 2026-10-09)
- Секреты сохранены локально: `~/.config/rox/platform-secrets-20261009.env` (chmod 600, только на машине; в репозитории — никогда).
- Проверено живыми вызовами: Telegram `@rox_one_bot` и тест-бот `@goskynetbot` — `getMe` ok; Cloudflare zone-токен активен (второй, account-токен, невалиден); Resend — ключ только на отправку; PostHog — ключи принадлежат Cloud US (self-hosted `posthog.rox.one` их не принимает и имеет собственный project key).
- Десктоп уже настроен на self-hosted аналитику: `POSTHOG_HOST=https://posthog.rox.one`, `OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.rox.one` (baked defaults, consent-gated).
- Jam (team id + PAT) — сниппет добавлен в репо (`apps/marketing/src/app/layout.tsx`, коммит сайта `c0d389c`) и доставлен на живой сайт через nginx (см. §7.8).

### 7.8 Финиш волны 3 — онбординг, локали, живой сайт, tg-linkd (2026-10-09 ~05:45)
- **Онбординг.** Коммит `4c2fa6158` (слияние, −2938 строк), финальный коммит `cccecf69e`: удалено неподпитанное identity-плечо первого запуска (WelcomeStep сам сохраняет личность через `persistOnboardingUsername`; `finishFirstRun` больше не вливает пустые `username`/`organization` в draft; поля убраны из `FirstRunDraft`/`loadFirstRunDraft`; мёртвый ре-экспорт `HandleCheckStatus` снят). Выбор keep-awake из анкеты теперь зеркалится в реальную настройку существующим каналом `power.SET_KEEP_AWAKE` (fire-and-forget за гейтом по бриджу; срабатывает и на Continue, и на Skip). Строки `launchAgent`/`chatHistory`/`installedApps`/`browserAutomation` остаются только в draft: приложения за ними в коде нет.
- **Локали.** Коммит `db28ac55f`: 19 ключей `onboarding.github.*` дозаполнены в десяти локалях (en/ru пришли с github-link коммитом параллельной сессии); parity снова зелёный — 11 локалей × 10010 ключей, сортировка чистая.
- **Гейты волны (объединённое дерево, HEAD `cccecf69e`).** `typecheck:all` — 0 ошибок; `bun run test --filter onboarding` — 26/26; `--filter github` — 9/9; `--filter fabric` — 17/17. Поведенческий throwaway-пробник подтвердил вызов `setKeepAwakeWhileRunning(true)` на выходе из анкеты и штатное продолжение без бриджа (2/2; временный файл удалён, в репо не попал).
- **Живой сайт rox.one.** Jam-сниппет доставлен без изменения контента, на слое nginx контейнера 101 (`rox-web-101-ct` / `ROX`, 100.126.90.2, Ubuntu 24.04): в `/etc/nginx/sites-available/rox-one-direct.conf` добавлен `sub_filter '</head>' → «meta jam:team + recorder.js + capture.js + </head>`», вместе с `proxy_buffering on`, `proxy_set_header Accept-Encoding ""` и gzip-пересжатием для клиентов. Оригинал сохранён как `rox-one-direct.conf.bak-20261009T023656Z` (sha256 `b3c5925e…`, 2652 Б); `nginx -t` ok, `systemctl reload nginx`. Проверка снаружи: ответ 200, 81 693 Б = 81 487 Б до + ровно 206 Б вставленного блока; «после минус вставка» побайтово равен «до» для `/` и `/team`; страницы `/`, `/team`, `/pricing`, `/changelog`, `/download`, `/security`, `/login` содержат meta+оба скрипта ровно по одному разу, повторные запросы не дублируют; `robots.txt`/`manifest.json`/`sitemap.xml` без изменений; статические ассеты по-прежнему отдаются gzip. Cloudflare в пути нет (DNS-only, ответ `server: nginx`). Откат: `cp -p` бэкапа обратно + `nginx -t && systemctl reload nginx`.
  Готча доступа: Tailscale SSH к `ROX`/`rox-web-101-ct` отдаёт баннер записи сессии и начинает выполнять команды только через 25–30 с (узел-рекордер `tsrecorder` офлайн); короткие таймауты выглядят как зависание — рабочий вызов: таймаут ≥60 с и `ServerAliveInterval=5`.
- **tg-linkd (R4) — локально на этой машине.** Бандл собран из репозитория в `/Users/t/.local/share/rox/tg-linkd/`; LaunchAgent `com.rox.tg-linkd` (RunAtLoad + KeepAlive, лог `~/Library/Logs/rox-tg-linkd.log`), токен читается wrapper-скриптом (700) из 600-файла секретов — в plist и логах токена нет. Проверено: `/api/health` → `{"ok":true,"bot":"rox_one_bot"}`; реальный `POST /api/link/start` → deep link + 8-значный код; `kill -9` → launchd поднимает службу сам; повторный bootstrap не создаёт дубликат. Десктоп по умолчанию целится в `http://127.0.0.1:8095` — настройка приложения не требуется. Откат: `launchctl bootout gui/$(id -u)/com.rox.tg-linkd`, удалить plist, каталог и лог.
- **Состояние общего worktree.** Незавершённый `git stash pop` (unmerged `docs/plan.md`, `docs/spec.md`, `docs/final-readiness/execution/cloud/OWNER-UI-001/result.json`) разрешён в 06:45 к содержимому ветки: у plan/spec сторона стэша не содержала ни одной уникальной строки (0 строк), у result.json уникальные строки — более старая ревизия записи (owner-UI-001 от 2026-10-04), текущая версия полнее (5474 против 3479 строк). Рабочее дерево чистое, сам стэш `stash@{0}` не удалён (его содержимое по-прежнему восстановимо), файлы вернулись к версии HEAD байт-в-байт.

### 7.9 Отключение Sentry и Telegram-виджет на сайте (2026-10-09, финальная проверка)
- **Sentry отключён и удалён** решением владельца — в обоих репозиториях:
  - десктоп `rox-int2`: коммит `40cde358d` (запушен в `feat/rox-platform-20261009`) — сняты зависимости `@sentry/electron`, `@sentry/react`, `@sentry/vite-plugin`, `@sentry/cli` (trustedDependencies); убраны инициализация в main/preload/renderer, оба capture-сайта (заменены на `console.error`/`mainLog` с тем же контекстом), `Sentry.setTag`, моки в четырёх тестах, shim `apps/webui/src/shims/sentry-electron.ts` и vite-алиасы, define `SENTRY_ELECTRON_INGEST_URL` в сборке, строка в `.env.example`. `machineId` сохранён — он общий с PostHog/OTLP, а не только с Sentry.
  - сайт `rox-one-website`: коммит `b734b13` — сняты `@sentry/nextjs`, `sentry.server/edge.config.ts`, `instrumentation*.ts`, capture в `global-error.tsx`, env-контракт `SENTRY_*`/`NEXT_PUBLIC_SENTRY_*`, Turbo-passthrough и упоминания Sentry в юридических документах (субпроцессоры, безопасность).
  - Доказательства: `grep -rIn "@sentry"` по исходникам пуст (в `rox-int2` остаётся только строковый каталог внутри вендорного бинаря `apps/electron/vendor/bun/bun` — он не редактируемый и не связан с интеграцией); `bun.lock` без `@sentry` в обоих репозиториях; пересобранные бандлы (`main.cjs`, renderer-dist, webui-dist) — 0 вхождений; `typecheck:all` в `rox-int2` — чисто; на сайте `bun test` (137/137 в приложении, 43/43 в `@rox/auth`) и `typecheck` 7/7.
- **Telegram Login Widget на сайте — построен, развёрнут и проверен** (сайт, main `6032d06`):
  - `b68eb4a`: виджет и колбэк целятся в auth-origin (`NEXT_PUBLIC_BETTER_AUTH_URL` → `https://rox.one`), а не в `NEXT_PUBLIC_API_URL` (`app.rox.one`, Render — сейчас suspend); серверные редиректы неуспеха ведут на `/login` вместо отсутствующего `/sign-in`; добавлена `resolveTelegramCallbackUrl()` (same-origin guard против open redirect) с юнит-тестами.
  - `b35e962`: виджет смонтирован на живых страницах — `/login` (под тем же чекбоксом согласия, что и Яндекс, `callbackURL=nextPath`) и `/account/security` (карточка привязки для вошедших); компонент перенесён из `_port/from-web` в `@/components/TelegramLoginButton` (PortGuard запрещает app→_port импорты), решение зафиксировано ADR 0004 в репозитории сайта.
  - Прод CT101: в `/etc/rox-one-website.env` добавлены `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=rox_one_bot` (файл 600); текущий релиз — `site-20261009-telegram3-b35e962`, сервис active. Все предыдущие релизы сохранены; откат: `ln -sfn /opt/rox-one/releases/site-20261003-pocket-sso-off-13ee25f /opt/rox-one/current && systemctl restart rox-one-website`.
  - Проверки снаружи (с этой машины): `/` 200 (+1 вхождение «jam:team»), `/login` 200, `/account` 307 (гейт авторизации), колбэк `/api/auth/telegram/callback?hash=…` → 302 `https://rox.one/login?error=telegram_failed`; в чанках живого билда присутствуют код виджета (`telegram-widget.js`), путь колбэка и значение `rox_one_bot`.
  - Остаётся одно действие владельца: @BotFather → `/setdomain` → `@rox_one_bot` → `rox.one`. Без него официальный виджет рисует в iframe «Bot domain invalid». Телефон для виджета не нужен: фраза из ТЗ «номер телефона — необходим» относится к регистрации (телефон нового пользователя → код через бота, R4) — не реализована, зафиксирована в ADR 0004 как отложенная.
- **Находки двойной проверки.** `app.rox.one` (Render `rox-web-kecj`) отвечает 503 `x-render-routing: suspend`: сервиса нет в аккаунте, чей ключ лежит в `~/.config/render/api.key` (там только `rox-shots-*`), а на этот хост ведут ссылки «Дашборд»/`/agents` с сайта и `loginPage`/`consentPage` OAuth-провайдера — нужно решение владельца (поднять сервис или перевести ссылки на rox.one). Тест `apps/electron/src/main/__tests__/session-branch-rollback.isolated.ts` падает и на неизменённом дереве (A/B-проверка с возвратом мока) — пре-существующее, не связано с удалением Sentry. `bun run lint` в сайтовом репозитории не работает: `biome.jsonc` использует ключи `files.includes`/`tailwindDirectives`, которых нет в закреплённой версии Biome (lint в CI отсутствует).
- **Остаточный зазор.** Визуальный клик по кнопке Telegram-виджета не проверен: браузерный бэкенд харнесса на этой сессии отказывал (четыре разных сбоя — detach фрейма, таймаут открытия, «tab not ready», ошибка `evaluateOnNewDocument`), а полноценная проверка всё равно требует `/setdomain` от владельца. Всё, что проверяемо без него, проверено (код в чанках, серверный колбэк, отсутствие сторонних регрессий).

### 7.10 Второй проход проверки (2026-10-09 ~10:30): прод-блокер Telegram, адверсариальные ревью, durable-лог
- **Прод-блокер найден пробой и исправлен.** Прод отвечал `HTTP 500` на первую регистрацию через Telegram: глобальный databaseHook `user.create.before` (`oauth-legal-evidence`) в проде требует валидную cookie `rox_legal_signup_proof`, а её выпускал только Яндекс-поток. Исправление (сайт, коммит `10ffedf`): `/api/auth/legal-sign-in` принимает `provider: "telegram"` (source `telegram_login`, TTL 15 мин, без OAuth), страница входа вызывает его при отметке чекбокса, плагин проверяет proof сам и редиректит на `/login?error=telegram_legal`, строки согласий помечаются `accept_*_before_telegram`.
- **Прод-пробы после деплоя `site-20261009-telegram4-10ffedf`** (мои, с этой машины): валидный payload без cookie → `302 → /login?error=telegram_legal` (было 500); с cookie, выпущенной живым эндпоинтом, → `302 → /account/security` + сессионные cookie; в БД `rox_prod` появились строки `legal_consents` с `source=telegram_login` и действиями `accept_terms_before_telegram`/`acknowledge_privacy_before_telegram`. Тестовый пользователь после проверки удалён из `auth.users/accounts/sessions` и `public.user_profiles/legal_consents`; остальные пользователи не затронуты.
- **Виджет в реальном браузере (Playwright на живом проде):** отметка чекбокса → `POST /api/auth/legal-sign-in → 200`, cookie `rox_legal_signup_proof` (httpOnly/secure/Lax, ~900 c), в блоке появляется iframe `oauth.telegram.org/embed/rox_one_bot?origin=https://rox.one…`, ошибок страницы нет. Iframe отвечает «Bot domain invalid» — единственный оставшийся шаг за владельцем: @BotFather → `/setdomain` → `@rox_one_bot` → `rox.one`.
- **Адверсариальные ревью (два read-only воркера).** Сайт: блокер (legal proof — к моменту ревью уже исправлен), UX-немота при отказах привязки → исправлено (`resolveSameOriginCallbackUrl`, возврат залогиненного пользователя на его `callbackURL` с сообщением, карточка на `/account/security`); удаление Sentry, open-redirect guard и перенос виджета — чисто. Десктоп: замены Sentry-захвата писали в заглушённые в проде транспорты электрон-лога → добавлен всегда-включённый `errorLog` (`<config>/logs/errors.log`, ротация 5 МБ, санитайз meta через `redactSensitiveValues`/`redactUrlForLog`), четыре обработчика ошибок переведены на него; удалены мёртвые in-place хелперы редактирования из `@rox/shared`; `dist-server/` добавлен в `.gitignore` (коммит `d93b2c079`).
- **Гейты этого прохода:** сайт — `@rox/auth` 50/50, marketing 139/139, `typecheck` 7/7; десктоп — `typecheck:all` чист, тесты `logger.errors`, `auto-update-suppress` и оба `redaction` зелёные.
- **Найдено и исправлено при финальной проверке: демон `rox-tg-linkd` душился launchd.** В LaunchAgent стоял `ProcessType=Background`, из-за чего первый запрос после простоя отвечал ~5.3 с (а `/api/link/start` и `/api/link/status` в диалоге линковки ощущались бы как зависание). После перевода агента в `Interactive` + `NSAppSleepDisabled=1` (перезагрузка через `launchctl bootout`/`bootstrap`) тот же запрос отвечает **2 мс**. Правка зафиксирована в `services/rox-tg-linkd/README.md` (раздел «Deploy as a macOS LaunchAgent»), чтобы будущие установки не повторили конфигурацию.
- **Открытые решения владельца:** (1) `/setdomain` в BotFather; (2) `app.rox.one` (Render `rox-web-kecj`) отвечает 503 `x-render-routing: suspend` — туда ведут 4 места сайта (ссылка «Дашборд» в шапке, CTA-кнопки, `/agents`, `desktop/connect`) и `loginPage`/`consentPage` OAuth-провайдера, причём `/oauth/consent` в маркетинг-приложении вообще отсутствует: решить — поднять сервис или перевести ссылки/страницы на rox.one; (3) браузерный бэкенд omp-харнесса на этой сессии стабильно падал (обход — Playwright с уже установленным Chromium 1148).

### 7.11 Телефонная регистрация через бота + вывод app.rox.one (2026-10-09 ~11:00)

- **R4 закрыт в веб-форме, ровно как задумал владелец: «поделился контактом — и всё».** Сайт (`/login`) создаёт заявку и показывает диплинк `t.me/rox_one_bot?start=<token>`; пользователь жмёт Start, бот отвечает приветствием и кнопкой «📱 Поделиться телефоном» (`request_contact`), контакт уходит боту, сайт по поллингу видит `ready` и создаёт/находит аккаунт по номеру (E.164, `auth.users.phone_number` + `phone_number_verified`, миграция `0005_telegram_phone.sql`), пишет согласия `source=telegram_phone` и выдаёт сессию. Кода нет; в боте есть inline-кнопка «Это не я» (`rx-cancel:<token>`) для отмены пересланного запроса.
- **Бот переехал на платформу.** `rox-tg-linkd` (единственный потребитель `@rox_one_bot`) — теперь systemd-сервис на CT101 (`services/rox-tg-linkd/deploy/rox-tg-linkd.service`: DynamicUser + StateDirectory `/var/lib/rox-tg-linkd`, loopback `:8095`, env `/etc/rox-tg-linkd.env` 600). Локальный LaunchAgent на Mac выключен, чтобы `getUpdates` не конфликтовал (409).
- **Сайт ↔ демон.** Сайт ходит на демон по loopback (`TG_LINKD_URL`/`TG_LINKD_TOKEN`, добавлены в `globalPassThroughEnv` turbo — иначе strict-режим не пропустил бы их в рантайм). Публичный прокси `/api/link/*` (Bearer `ROX_TG_LINK_PUBLIC_TOKEN`) сохранён для десктопной линковки: `DEFAULT_TG_LINK_URL` десктопа → `https://rox.one`, токен `ROX_TG_LINK_TOKEN` описан в `.env.example`.
- **app.rox.one снят с продукта (ADR 0005 сайта).** Ссылки шапки/CTA/скачивания → относительный `/account`; редирект `/@handle` на подвешенный хост удалён; письма и юридические тексты → rox.one; `@rox/shared/product-origins` удалён как мёртвый; `NEXT_PUBLIC_WEB_URL/API_URL/ADMIN_URL` = rox.one; хеши юридических документов в `legal-document-evidence` пересчитаны (иначе хеш-гейт регистрации падал бы). Исходники облачного веб-приложения есть только в `rox-one/old` (`apps/web`), в проде нет таблиц `oauth`/`organization` — провайдер и организации дормантны; `/oauth/consent` и `/accept-invitation` — известные гэпы.
- **Приёмка на живом проде:** `POST /api/auth/legal-sign-in` → proof-cookie; `POST /api/auth/telegram-phone/start` → 200 + диплинк (демон жив: `{"ok":true,"bot":"rox_one_bot"}`); полный E2E с подменой Bot API на мок: `/start <token>` → приветствие + `request_contact`-клавиатура; контакт `+79990000001` → «Номер +7 999 ***-**-01 подтверждён…» + inline «Это не я»; `GET …/status` → `{"status":"ready","redirectTo":"https://rox.one/account"}` + сессионные cookie (`__Secure-better-auth.session_token`); в БД — пользователь `phone_79990000001@phone.rox.local` с `phone_number_verified=t` и согласия `telegram_phone`. Пробные строки удалены (счётчики вернулись к 4/4/23/18), демон возвращён на `api.telegram.org`. Также: `/api/link/start` через прокси → 200 с кодом, без токена → 401; боту заданы описание, короткое описание и команда `/start`.
- **Гейты:** сайт — typecheck 7/7, `@rox/auth` 79/79, marketing 149/149, email 62/62, db 170/170, workflow-core 250/250 (в `@rox/shared` один пред-существующий провал: `mcp-catalog.test.ts` ждёт `packages/mcp-v2`, которого в экстракте нет); десктоп — typecheck чист, `rox-tg-linkd` 40/40, бандл собирается.
- **Коммиты:** сайт `bb6b42e` (релиз `site-20261009-tgphone-bb6b42e`), десктоп `48dadd5c6`.

---

### 7.12 Волна 4 — веб-сессии Rox ID, импорт из облаков, Jam (2026-10-09 ~12:30)
- **Webui: пользовательские сессии через Rox ID (Pocket ID OIDC).** Код: `packages/server-core/src/webui/{auth,http-server}.ts` + `apps/webui` (`login.html`, `adapter/web-api.ts`). Env: `ROX_WEBUI_OIDC_ISSUER/CLIENT_ID/CLIENT_SECRET/PUBLIC_URL`; discovery/JWKS/PKCE S256/id_token (RS256, iss/aud/exp/nonce/sub) реализованы на `node:crypto`, сессия — прежний HS256-cookie. Парольный вход сохранён и работает как раньше без OIDC; при включённом Rox ID POST `/api/auth` отвечает 404, пока явно не задан `ROX_WEBUI_PASSWORD_LOGIN=1`. Харденинг по ревью: rate-limit на старте логина + кап ожидающих состояний (256), связка состояния с браузером через one-time cookie `oidc_state` (login-CSRF), перевыпуск JWKS при неизвестном `kid`, `Secure` из https публичного URL. Тесты 46/46.
- **Drive: импорт из облаков (Google Drive / OneDrive / Яндекс.Диск; iCloud — честный unsupported).** Конвейер `packages/shared/src/drive/importers/` (резюмируемый runner, 8 потоков по умолчанию (R15), retry, guard циклов, «ошибка планирования ≠ done», валидация job-id), SigV4-приёмник S3 без SDK (self-hosted SeaweedFS, бакет `rox-drive`), провайдеры (Google `drive.readonly` + пропуск Drive-документов, OneDrive `/common`, Яндекс — dotted `fields`). Хост-композиция: `createDriveService()` в Electron main поднимает движок (`<CONFIG_DIR>/drive/imports`) и регистрирует провайдеров; OAuth выполняет **main-процесс** через новые каналы `drive:importAuthStart/Complete` (+ loopback-обёртки preload), токены ложатся в CredentialManager-слот `service_oauth::global::import-<provider>`; рендер ведёт диалог (код устройства, прогресс, пауза/резюм/отмена) и показывает ошибки хоста дословно.
- **Google OAuth-клиенты созданы** в проекте `project-66a9c35d-5049-4078-ae6`: Desktop/PKCE `903729003071-pj3u…` (drive.readonly для импорта, calendar.events для календаря) и device-flow `903729003071-b85m…` (в device flow доступен только `drive.file`). Секреты — `~/.config/rox/google-oauth.env` (600) и `.env` рабочего дерева (600, gitignored).
- **Jam** подключён в webui: `apps/webui/src/jam.ts`, включение только по согласию (`rox.jam.enabled`), team из `VITE_JAM_TEAM`.
- **Гейты волны:** `bun run typecheck:all` — 0 (включая cli/viewer/webui/cloud-gateway в цепочке main); тесты по файлам: webui 46, runner 14, r2 11, провайдеры 35, drive rpc 7, renderer drive 22, jam 3, ipc 8, routing 26, channel-map parity 4; i18n parity 11×10043; сборки electron-renderer и webui — exit 0; живой E2E: `/api/auth/login` → 302 на `https://pocketid.rox.one/authorize` с `oidc_state`.
- **Адверсариальные ревью (5 линз + security-reviewer):** исправлено 15+ дефектов, включая «успешный импорт 0 файлов» при провале планирования, синтаксис `fields` Яндекс.Диска (проверен против живого API), невозможность перечислить Drive под `drive.file`, отсутствие хостовой композиции импорта и CSRF/DoS/ротацию ключей в OIDC.
- **Открытые решения владельца:** (1) объектное хранилище Drive: ✅ self-hosted S3 (SeaweedFS на хосте `sw`, бакет `rox-drive`, `https://s3.rox.one`, проверено 2026-10-09; операторский шаблон `~/.config/rox/drive-s3.env`, ранбук `docs/drive-object-storage.md`); (2) CT104 — переключить issuer на `https://id.rox.one` и создать OIDC-клиент `rox-webui` (нужен доступ: NetBird на Mac или креды PVE/CT104); (3) регистрации приложений Microsoft (`ROX_MS_CLIENT_ID`) и Яндекс.Диска; (4) решения по веб-режимам (cloud-runs-auth) и стоимости PostHog VM.

### 7.13 Волна 5 — доработки импортёра, markdown-фикс, уборка (2026-10-09 ~15:00)
- **Отмена импорта из облаков.** Новый канал `drive:importCancel` (LOCAL_ONLY + перегенерированный инвентарь каналов), RPC-обработчик вызывает `runner.cancel()`, статус задачи — `cancelled` (повторная отмена завершённой задачи даёт типизированную ошибку `DRIVE_IMPORT_NOT_CANCELLABLE`). Кнопка «Отменить» в диалоге теперь действительно отменяет (раньше мапилась на pause, и брошенная задача навсегда оставалась на хосте), рендер показывает отменённое состояние, i18n-ключ добавлен во все локали.
- **Content-Type при импорте.** `mimeType` из листинга провайдера (Google `mimeType`, OneDrive `file.mimeType`, Яндекс `mime_type`) протянут в план и в `target.put(...)` — объекты в приёмнике получают корректный тип.
- **Таймауты против зависших сокетов.** Общий модуль политики: жёсткий бюджет 30 с на запросы (листинги, токены, ссылки) и 30-секундное *окно прогресса* для потоков (скачивание и стриминговый PUT): медленный, но движущийся поток не обрывается, полностью зависший — прерывается типизированной ошибкой (`network` у провайдеров; у S3-приёмника сохранён `DRIVE_IMPORT_S3_PUT_FAILED` + `timeout:true`).
- **Markdown-экранирование.** `@tiptap/markdown` ≥3.21 начал экранировать `[[…]]` и `[!callout]` при сериализации — регрессия двух тестов на main. В `packages/ui/.../official-markdown.ts` восстановлена verbatim-сериализация для боевого движка (и для parity-фикстуры); набор markdown-тестов зелёный (281), ранее красные тесты проходят без ослабления проверок.
- **Уборка.** В GCP-проекте удалены два лишних OAuth-клиента (остались рабочие: `903729003071-pj3u…` Desktop/PKCE и `903729003071-b85m…` device-flow).

### 7.14 Волна 6 — R2 → свой S3, веб-поверхность облачных ВМ (2026-10-09 ~18:30)
- **Cloudflare R2 исключён (решение владельца).** Объектное хранилище Drive — self-hosted S3: SeaweedFS на хосте `sw` (юнит `rox-drive-s3`, данные `/opt/rox-drive/data`, S3-ключи `/opt/rox-drive/s3.json` 0600, все порты на loopback), публикация `https://s3.rox.one` (Caddy + Let's Encrypt, DNS A → 34.65.148.193 без прокси), бакет `rox-drive`. Проверено end-to-end: подписанный SigV4 PUT/GET (stdlib-скрипт), клиент репозитория (`createS3UploadTarget`) через локальный туннель и через публичный HTTPS с другого хоста, чтение объектов после `systemctl restart rox-drive-s3`, анонимный доступ — 403. Ранбук — `docs/drive-object-storage.md`; воспроизводимая установка — `deploy/rox-drive-s3/`; вопрос офсайт-бэкапа — issue #1728. Всё вместе — PR #1731.
- **Конфиг приложения из файла.** `composeDriveImportEngine()` резолвит приёмник сначала из `process.env`, затем из операторского файла `<configDir>/drive-s3.env` (`loadEnvFile` в `packages/shared/src/drive/importers/env-file.ts`) — упакованное приложение не видит shell-окружение; на Mac владельца `CONFIG_DIR` резолвится в `~/rox`. Тесты: env-file 10 + композиция 2.
- **R16: веб-поверхность «облачная ВМ».** Лендинг больше не теряет выбранный режим: при выборе «Облачная ВМ» над смонтированным рендерером открывается web-only поверхность `apps/webui/src/cloud-vm-surface.tsx` — реальные действия через существующие каналы `cloudRuns.*`: список запусков, «Новый запуск» (обязательный `topic`), «Отменить» для активных состояний, «Открыть» → `navigate(routes.view.cloudRun(id))`, честные состояния недоступности/ошибок из `web-modes.ts`. Чистая логика — `cloud-vm-runs.ts` (юнит-тесты), i18n `webui.cloudVm.*` × 12 локалей (паритет 11×10971).
- **Остаток, требующий владельца/инфраструктуры:** CT104/Pocket ID — рабочий путь доступа не найден (NetBird на Mac не запущен, PVE root и CT104 SSH отвергают пароль, tailnet-узел `100.87.245.112` — это `testct`, не PVE) → issue #1725; регистрации приложений Microsoft/Яндекс для импортёров → issue #1727.

## 8. Доступ агентов к Keeper (2026-10-09)

Агенты получают локальное хранилище через два интерфейса плюс скилл:

- **CLI**: `craft-cli keeper list|get|create|delete|status`. Секреты всегда маскируются; `get --reveal` работает только при `ROX_KEEPER_ALLOW_REVEAL=1` (fail-closed — отказ до вызова `keeper:reveal`). Пароль/TOTP при `create` можно подавать через stdin, не попадая в историю команд.
- **MCP-инструмент `keeper`** (`session-mcp-server`): действия `list/get/create/update/delete`. Значения маскируются, если не заданы одновременно `reveal:true` и операторский флаг; каждый ответ повторно санитизируется на стороне инструмента, поэтому неверный релей не может «просочить» секрет в контекст модели. Транспорт — loopback-релей к процессу десктопа (владелец vault).
- **Скилл** `apps/electron/resources/skills/keeper/SKILL.md`: не эхоить секреты, ссылаться по `id`, reveal как узкое исключение.

Тесты: CLI — парсинг аргументов, гейт `--reveal`, маскированный `get`; MCP — схема инструмента, маскирование и гейт. Всё на фейковом RPC-транспорте, без записи в vault.
