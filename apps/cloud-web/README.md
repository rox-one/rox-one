# Rox Cloud Web

Одно приложение на SolidJS для трёх поверхностей:

- сайт `/`, `/pricing`, `/docs`, `/status` — продукты, цены и вход без регистрации;
- кабинет `/console` — конфигуратор, машины, терминал, счёт, ключи, поставщики, журнал;
- панель дежурного `/admin` — клиенты, балансы, ключи, машины, журналы, поддержка, рубильник.

## Запуск

```bash
# из корня репозитория
bun install
bun run --cwd apps/cloud-web dev     # Vite на 5173, /v1 и /health проксируются на 8787
```

API запускается из `apps/cloud-api`; переменные и порядок описаны в
`apps/cloud-api/README.md`. Для локальной проверки нужны `ROX_MASTER_KEY`,
`ROX_PLATFORM_RATE_CENTS_PER_HOUR`, `ROX_BOOTSTRAP_KEY`, `ROX_ADMIN_KEY`;
гостевой вход включается `ROX_GUEST_ENABLED=1`, пробные машины идут на
`ROX_PLATFORM_DAYTONA_KEY`.

## Сборка и проверка

```bash
bun run --cwd apps/cloud-web build       # apps/cloud-api/public/app
bunx tsc --noEmit -p apps/cloud-web
```

Собранные файлы не коммитятся: они лежат в `apps/cloud-api/public/app` и
пересобираются. Сервер отдаёт `/assets/*` с долгим кешем, а оболочку
`index.html` — без кеша; старые адреса `*.html` перенаправляются на новые
маршруты (`src/spa.ts` в API).

## Устройство

- `src/styles` — токены, база и общие компоненты; `Rox Mono Typeface`, светлая
  компактная тема, движение 140–180 мс и `prefers-reduced-motion`.
- `src/components` — кнопки, карточки, поля, таблицы, диалоги, тосты, иконки.
- `src/lib/api.ts` — клиент API, ошибки с `request_id`; ключ клиента и ключ
  дежурного живут только в `sessionStorage`.
- `src/routes/site`, `console`, `admin` — три поверхности со своими стилями;
  общими остаются компоненты и токены.
- `src/App.tsx` — маршруты; `src/spa.ts` в API — безопасная отдача сборки.

Цены, состав продуктов и доступность берутся из `@rox/cloud-pricing`
(`packages/cloud-pricing`), чтобы сайт, кабинет и счёт не расходились.
