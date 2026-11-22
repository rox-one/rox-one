# План: сайт, кабинет и панель Rox Cloud

Спецификация: `docs/cloud-product-spec.md`. Ветка `feat/cloud-byok`. Общая проверка после каждой волны: тесты API, сборка веба, живые снимки.

## Волна 1. Основа (параллельно)

### A. Бэкенд: цена, режимы, гости, образы, ключи, журналы

Файлы (владелец один, конфликтов нет):

- `packages/cloud-pricing/package.json`, `src/index.ts`, `src/index.test.ts` — таблица продуктов, `retailCentsPerHour`, `serviceFeeCentsPerHour`, `formatCents`.
- `packages/cloud-runner/src/sandbox.ts` — `region?` в `SandboxSpec`, `ProviderImage`, `listImages?` в `SandboxProvider`.
- `packages/providers/src/daytona.ts` — `target` из `region`, `listImages()` через `GET /snapshots`, площадки `us`/`us-west-4`.
- `packages/providers/src/modal.ts`, `e2b.ts` — заглушки `listImages` не добавлять; тип необязательный.
- `apps/cloud-api/src/platform.ts` (новый) — чтение `ROX_PLATFORM_DAYTONA_KEY`/`DAYTONA_API_KEY`, `platformProviders()`, `managedProviders()`, отпечаток последних 4 без секрета.
- `apps/cloud-api/src/integration.ts` — `resolveProvider` возвращает `{ provider, mode }`, гостевой/платформенный ключ при отсутствии своего; ставка из запроса.
- `apps/cloud-api/src/app.ts` — `billingMode`, `quote`, ставка в записи, `region`, `images`-маршрут, гостевой маршрут, каталог с ценами и `managed_providers`, расширенный JSON машины.
- `apps/cloud-api/src/store.ts` — `rateCentsPerHour`, `retailCentsPerHour`, `billingMode`, `region` в записи; `revokedAt` у ключа; кольцо запросов; `guest` у клиента.
- `apps/cloud-api/src/auth.ts` — отказ отозванному ключу.
- `apps/cloud-api/src/persistence.ts` — сохранить и восстановить новые поля, отзыв, гостя.
- `apps/cloud-api/src/admin.ts` — перевыпуск ключа, список ключей с балансом, журнал запросов, фильтры аудита, платформенные ключи в обзоре.
- `apps/cloud-api/src/meter.ts` — ставка из записи, запасная общая.
- `apps/cloud-api/README.md` — новые переменные и маршруты.
- Тесты: `apps/cloud-api/src/__tests__/pricing.test.ts`, `guest.test.ts`, `images.test.ts`, `rotate.test.ts`, `requests.test.ts`; правки `app.test.ts`, `admin.test.ts`, `meter.test.ts`, `persistence.test.ts`.
- НЕ трогать `apps/cloud-api/src/server.ts` (сборка его подключает оркестратор), старые фронтенды и пользовательские файлы.

Проверка: `bun test apps/cloud-api packages/cloud-runner packages/providers packages/cloud-pricing`; `tsc` API; живой `GET /v1/catalog`, `/v1/providers/daytona/images`.

### B. Каркас веба

- `apps/cloud-web/{package.json,tsconfig.json,vite.config.ts,index.html}` — SolidJS + Vite, сборка в `../cloud-api/public/app`, прокси `/v1` на 8787, `base: "/"`, `fs.allow` до корня репозитория.
- `src/main.tsx`, `src/App.tsx` — маршруты `/`, `/pricing`, `/docs`, `/status`, `/console`, `/console/machines`, `/console/machines/:id`, `/console/invoice`, `/console/keys`, `/console/providers`, `/console/journal`, `/admin`, `/admin/clients`, `/admin/clients/:id`, `/admin/machines`, `/admin/keys`, `/admin/logs`, `/admin/support`, `/admin/security`; ленивые импорты, файлы-оболочки для страниц.
- `src/styles/tokens.css`, `base.css`, `components.css` — токены и компоненты из спецификации.
- `src/components/*` — `Button`, `Card`, `Stat`, `Badge`, `Field`, `Select`, `Textarea`, `Switch`, `Tabs`, `Dialog`, `Toast`, `Table`, `EmptyState`, `Skeleton`, `CodeBlock`, `Icon`, `Money`, `PageHeader`.
- `src/lib/api.ts` — клиент всех маршрутов, `request()` для нестандартных, ошибки с `request_id`, сессия клиента и админа.
- `src/lib/session.ts`, `src/lib/format.ts` — ключи в `sessionStorage`, деньги и даты по-русски.
- `src/spa.ts` (в `apps/cloud-api/src/`) — `serveSpa(req): Promise<Response | null>`: `/`, `/console/*`, `/admin/*`, `/assets/*`, безопасные пути, MIME, `index.html` для клиентских маршрутов.
- НЕ трогать `apps/cloud-api/src/server.ts`, бэкенд, старые фронтенды.

Проверка: `bun run --cwd apps/cloud-web build`, `bunx tsc --noEmit -p apps/cloud-web`.

## Волна 2. Страницы (параллельно, после каркаса)

- **Сайт** — `src/routes/site/*`: главная, цены, документация, состояние; продукты из `@pricing`; «Купить» → `/console?plan=…&guest=1`; общий заголовок и подвал; адаптив.
- **Кабинет, основа** — `src/routes/console/{index,Products,Machines,Invoice,Keys,Providers,Journal}.tsx`: боковое меню, гость, конфигуратор, запуск, список, счёт, ключи, поставщики, журнал.
- **Кабинет, машина** — `src/routes/console/{Machine,Terminal,Files}.tsx`: карточка машины, терминал с историей и каталогом, файлы, стоп/удаление.
- **Панель, клиенты** — `src/routes/admin/{index,Overview,Clients,Keys}.tsx`: вход по ключу, обзор, клиенты, баланс, пополнение, перевыпуск, ключи.
- **Панель, эксплуатация** — `src/routes/admin/{Machines,Logs,Support,Security}.tsx`: машины, два журнала, поддержка, рубильник.

Каждый агент владеет только своими файлами; общие компоненты и `api.ts` не менять; стили маршрута — в своём `*.css`.

## Волна 3. Сборка и приёмка

1. Подключить `platform.ts` и `spa.ts` в `server.ts`; отдавать `/v1/admin/*` и `/v1/status` до SPA; убрать старые статические маршруты; удалить `apps/cloud-site`, `apps/cloud-console`, `apps/cloud-api/public/admin.html` после успешной сборки.
2. Сервер: каждые 30 секунд останавливать машины с истёкшим `expiresAt` через обычный путь и рассчитывать плату; при восстановлении незавершённые записи сначала рассчитать по ставке за прошедшее время, затем пометить `failed`; кольцо запросов на входной двери (метод, путь без строки, код, длительность, клиент, последние 4 символа ключа, номер запроса) передать в `createAdminApp` через `requests`.
3. `bun install` (solid-js, @solidjs/router, vite-plugin-solid), `bun run --cwd apps/cloud-web build`, `bunx tsc --noEmit -p apps/cloud-web`.
4. Тесты: API, cloud-runner, providers, cloud-ops, cloud-pricing; контрактный тест с поддельным провайдером (снимки, создание по `product` и по `snapshot`, подмена cpu на GPU-снимке, exec `cwd`/`exit_code`, остановка, удаление, rotate 401/200, гость 6-й запрос, лимиты 2/17/86401); дым `scripts/cloud-smoke.sh` с новыми путями.
5. Живой сервер (`ROX_LIVE_DAYTONA=1`, `ROX_GUEST_ENABLED=1`, `ROX_PLATFORM_DAYTONA_KEY`): гость, `linux-pro`, терминал `uname -a`, стоп, удаление, счёт; панель: клиент, ключ, баланс, машина, действия, запросы; пополнение; перевыпуск (401/200).
6. Снимки 1365 и 390: сайт, конфигуратор, машина с терминалом, панель (клиенты, ключи, журнал). Проверить отсутствие горизонтальной прокрутки и обрезанного текста.
7. Коммит: `feat(cloud): product site, Solid console and staff panel`.

## Риски

- Daytona принимает `target` — проверить одним малым запуском; если нет, площадку не отправлять и честно писать «поставщик выбирает сам».
- GPU-снимок H100 не запускать: цена и время. Показывать в списке, не тестировать запуском.
- Гостевой ключ — платформенный; лимиты и потолок обязательны, иначе гости жгут счёт.
- Ставка теперь у каждой машины: проверить резерв, счётчик, остановку, перезапуск и старые записи.
