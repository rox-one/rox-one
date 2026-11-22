import { A } from '@solidjs/router'
import { For } from 'solid-js'
import type { JSX } from 'solid-js'

import { CodeBlock, PageHeader } from '@/components'

import { DAYTONA_CONSOLE_URL, LIVE_REGION } from './products'
import './docs.css'

const TOC: readonly { href: string; label: string }[] = [
  { href: '#quickstart', label: 'Быстрый старт' },
  { href: '#create', label: 'Создание машины' },
  { href: '#region', label: 'Площадка и снимки' },
  { href: '#exec', label: 'Команда' },
  { href: '#site-ssh', label: 'Сайт и SSH' },
  { href: '#stop', label: 'Остановка' },
  { href: '#keys', label: 'Ключи и поставщики' },
  { href: '#errors', label: 'Ошибки' },
]

const ERROR_ROWS: readonly { code: string; status: number; meaning: string }[] = [
  {
    code: 'invalid_request',
    status: 400,
    meaning: 'Тело или параметры не подходят, в том числе расходятся с составом снимка.',
  },
  {
    code: 'idempotency_key_required',
    status: 400,
    meaning: 'Создание пришло без заголовка Idempotency-Key.',
  },
  {
    code: 'capability_unavailable',
    status: 400,
    meaning: 'Нет ни своего, ни платформенного ключа этого поставщика.',
  },
  {
    code: 'authentication_required',
    status: 401,
    meaning: 'Ключ не передан, неизвестен или уже отозван.',
  },
  {
    code: 'permission_denied',
    status: 403,
    meaning: 'У ключа нет нужного права: например, keys:write или billing:write.',
  },
  {
    code: 'guest_disabled',
    status: 403,
    meaning: 'Гостевой вход на этом стенде выключен: нужен ключ дежурного.',
  },
  {
    code: 'not_found',
    status: 404,
    meaning: 'Объекта нет у этого клиента: чужая машина тоже отвечает 404.',
  },
  {
    code: 'insufficient_balance',
    status: 402,
    meaning: 'На кошельке не хватает денег на резерв за заявленный срок.',
  },
  {
    code: 'concurrency_exceeded',
    status: 409,
    meaning: 'Превышен лимит одновременных машин: у гостя он равен одной.',
  },
  {
    code: 'monthly_cap_exceeded',
    status: 409,
    meaning: 'Месячный потолок расхода уже исчерпан.',
  },
  {
    code: 'rate_limited',
    status: 429,
    meaning: 'Слишком много запросов за окно: подождите и повторите.',
  },
  {
    code: 'provider_error',
    status: 502,
    meaning: 'Поставщик отказал или недоступен; номер запроса есть в теле ответа.',
  },
]

export default function SiteDocs(): JSX.Element {
  return (
    <div class="page docs-page">
      <PageHeader
        eyebrow="Документация"
        title="Один интерфейс до работающей машины"
        description="Ключ, окружение, создание по продукту или снимку, команда с каталогом и кодом выхода, остановка. Сейчас запускаются три Linux-машины; Windows и H100 помечены «По запросу». Ниже — короткий путь и точные поля, которые принимает API."
        actions={
          <>
            <a class="btn btn-secondary" href="#quickstart">
              Быстрый старт
            </a>
            <A class="btn btn-primary" href="/console?guest=1">
              Открыть кабинет
            </A>
          </>
        }
      />

      <div class="docs-layout">
        <nav class="docs-toc" aria-label="Содержание документации">
          <p class="docs-toc-title">На этой странице</p>
          <For each={TOC}>{(item) => <a href={item.href}>{item.label}</a>}</For>
        </nav>

        <div class="docs-main">
          <section class="site-section docs-section" id="quickstart" aria-labelledby="quickstart-title">
            <div class="site-section-head">
              <p class="site-eyebrow">Быстрый старт</p>
              <h2 class="site-title" id="quickstart-title">
                Ключ, окружение, машина
              </h2>
              <p class="site-lede">
                Всё остальное — надстройка над этими запросами. Ключ в адресную строку не попадает и в
                журнале действий не сохраняется.
              </p>
            </div>
            <ol class="docs-steps">
              <li class="docs-step">
                <span class="docs-step-number" aria-hidden="true">
                  1
                </span>
                <div>
                  <h3 class="docs-step-title">Получите ключ</h3>
                  <p class="docs-step-text">
                    Кабинет создаёт гостевой ключ сам, с пробным балансом, если гостевой вход включён.
                    Для команды ключ выпускается в разделе «Ключи»: секрет показывается один раз. Первый
                    ключ на стенде задаёт <code>ROX_BOOTSTRAP_KEY</code>.
                  </p>
                </div>
              </li>
              <li class="docs-step">
                <span class="docs-step-number" aria-hidden="true">
                  2
                </span>
                <div>
                  <h3 class="docs-step-title">Задайте окружение</h3>
                  <p class="docs-step-text">
                    Оба значения читаются из переменных. На локальном стенде адрес API —{' '}
                    <code>http://localhost:8787</code>; когда сайт и API отдаёт один процесс, адрес тот
                    же, что у этой страницы.
                  </p>
                </div>
              </li>
              <li class="docs-step">
                <span class="docs-step-number" aria-hidden="true">
                  3
                </span>
                <div>
                  <h3 class="docs-step-title">Создайте машину</h3>
                  <p class="docs-step-text">
                    Заголовок <code>Idempotency-Key</code> обязателен: повтор с тем же телом вернёт ту же
                    машину, а не вторую. Продукт или снимок уже называют процессор, память и диск. Сейчас
                    запускаются три Linux-продукта: <code>linux-start</code>, <code>linux-pro</code> и{' '}
                    <code>linux-large</code>; Windows и H100 — по запросу.
                  </p>
                </div>
              </li>
              <li class="docs-step">
                <span class="docs-step-number" aria-hidden="true">
                  4
                </span>
                <div>
                  <h3 class="docs-step-title">Выполните команду</h3>
                  <p class="docs-step-text">
                    Команда уходит в машину, ответ приходит отдельно: <code>stdout</code>,{' '}
                    <code>stderr</code> и <code>exit_code</code>. Каталог задаётся полем{' '}
                    <code>cwd</code>.
                  </p>
                </div>
              </li>
            </ol>
            <CodeBlock
              label="Окружение"
              code={`export ROX_API_KEY=rox_sk_live_…
export ROX_API_URL=http://localhost:8787`}
            />
            <CodeBlock
              label="curl: создать машину по продукту"
              code={`curl -sS -X POST "$ROX_API_URL/v1/sandboxes" \\
  -H "Authorization: Bearer $ROX_API_KEY" \\
  -H "Idempotency-Key: first-machine-1" \\
  -H "Content-Type: application/json" \\
  -d '{"product":"linux-pro","region":"us","ttlSec":3600}'`}
            />
          </section>

          <section class="site-section docs-section" id="create" aria-labelledby="create-title">
            <div class="site-section-head">
              <p class="site-eyebrow">Создание</p>
              <h2 class="site-title" id="create-title">
                Продукт или снимок, но не оба
              </h2>
              <p class="site-lede">
                Продукт — это код из прайса, например <code>linux-pro</code>. Снимок — имя образа у
                поставщика, например <code>rox-cloud-medium-2x4</code>. Поля <code>cpu</code>,{' '}
                <code>memoryGb</code>, <code>diskGb</code> и <code>gpu</code> в теле служат только
                проверкой: расхождение со снимком — отказ, а не подмена ресурсов. Windows и H100 сейчас
                не запускаются: их конфигурации помечены «По запросу».
              </p>
            </div>
            <CodeBlock
              label="curl: создать по снимку"
              code={`curl -sS -X POST "$ROX_API_URL/v1/sandboxes" \\
  -H "Authorization: Bearer $ROX_API_KEY" \\
  -H "Idempotency-Key: first-machine-2" \\
  -H "Content-Type: application/json" \\
  -d '{"snapshot":"rox-cloud-medium-2x4","region":"${LIVE_REGION}","ttlSec":3600}'`}
            />
            <CodeBlock
              label="Ответ: как его вернёт API"
              code={`{
  "id": "sbx_…",
  "object": "sandbox",
  "provider": "daytona",
  "state": "running",
  "created_at": "2026-11-22T12:00:00.000Z",
  "expires_at": "2026-11-22T13:00:00.000Z",
  "cost_so_far_cents": 0,
  "cost_so_far_usd": "0.00",
  "spec": {
    "os": "linux",
    "cpu": 2,
    "memoryGb": 4,
    "diskGb": 8,
    "snapshot": "rox-cloud-medium-2x4",
    "gpu": null,
    "region": "us",
    "ttlSec": 3600
  },
  "region": "us",
  "billing": {
    "mode": "managed",
    "rate_cents_per_hour": 36,
    "retail_cents_per_hour": 36,
    "service_fee_cents_per_hour": 5
  }
}`}
            />
            <ul class="site-list">
              <li>
                <strong>Неизвестный снимок отклоняется до резерва.</strong> Сначала сервер находит снимок
                в живом списке поставщика, потом считает цену.
              </li>
              <li>
                <strong>Снимок с видеокартой — по запросу.</strong> <code>daytona-gpu</code> стоит 786 ¢/ч
                и показывает состав 16 ядер / 100 ГБ / 400 ГБ, но на этой организации Daytona нет
                кредитов GPU, поэтому запуск не предлагается. Кредиты выдаёт поставщик.
              </li>
              <li>
                <strong>Режим и ставка хранятся у машины.</strong> Счёт, резерв и остановка считают по
                ним, а не по общей настройке сервера.
              </li>
            </ul>
          </section>

          <section class="site-section docs-section" id="region" aria-labelledby="region-title">
            <div class="site-section-head">
              <p class="site-eyebrow">Площадка и снимки</p>
              <h2 class="site-title" id="region-title">
                <code>region</code> и живые снимки
              </h2>
              <p class="site-lede">
                Сейчас все доступные машины запускаются в <code>{LIVE_REGION}</code> — общей площадке
                Daytona. Выделенную <code>us-west-4</code> в этом срезе не проверяли. Список площадок и
                возможностей отдаёт каталог, точный состав снимков — отдельный маршрут. Если{' '}
                <code>region</code> не задан, поставщик выбирает сам.
              </p>
            </div>
            <CodeBlock
              label="curl: снимки, доступные этому ключу"
              code={`curl -sS "$ROX_API_URL/v1/providers/daytona/images" \\
  -H "Authorization: Bearer $ROX_API_KEY"

# {"object":"list","provider":"daytona","mode":"managed","data":[
#   {"id":"rox-cloud-medium-2x4","label":"Linux · Разработка",
#    "os":"linux","cpu":2,"memoryGb":4,"diskGb":8,"gpu":null,"state":"active"}]}`}
            />
            <p class="site-lede">
              Каталог <code>GET /v1/catalog</code> отдаёт продукты с ценами, возможности поставщиков и
              поле <code>managed_providers</code> — у кого работает платформенный ключ. Отдельного
              маршрута площадок нет: их список лежит в <code>providers[].regions</code>.
            </p>
            <p class="site-note site-note--plain">
              Если список снимков не получен, кабинет показывает продукты из каталога с пометкой «список
              образов недоступен» и не выдумывает ресурсы. Класс Windows и кредиты GPU выдаёт поставщик:
              их состояние видно в{' '}
              <a href={DAYTONA_CONSOLE_URL} target="_blank" rel="noopener noreferrer">
                кабинете Daytona
              </a>. Windows и H100 помечены «По запросу», пока этих квот нет.
            </p>
          </section>

          <section class="site-section docs-section" id="exec" aria-labelledby="exec-title">
            <div class="site-section-head">
              <p class="site-eyebrow">Команда</p>
              <h2 class="site-title" id="exec-title">
                <code>exec</code>: каталог, таймер, код выхода
              </h2>
              <p class="site-lede">
                Команда выполняется в машине, а не на сервере Rox. <code>cwd</code> задаёт рабочий
                каталог, <code>timeout_sec</code> — предел ожидания. Ответ всегда несёт{' '}
                <code>exit_code</code>: ненулевой код — это ответ команды, а не ошибка вызова.
              </p>
            </div>
            <CodeBlock
              label="curl: выполнить команду"
              code={`export SANDBOX_ID=sbx_…

curl -sS -X POST "$ROX_API_URL/v1/sandboxes/$SANDBOX_ID/exec" \\
  -H "Authorization: Bearer $ROX_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"command":"uname -a","cwd":"/root","timeout_sec":15}'

# {"stdout":"Linux rox …\\n","stderr":"","exit_code":0}`}
            />
            <ul class="site-list">
              <li>
                <strong>stdout и stderr разделены.</strong> Ошибка команды приходит в <code>stderr</code>{' '}
                с тем же HTTP-кодом 200, а не прячется в общий текст.
              </li>
              <li>
                <strong>Код выхода виден всегда.</strong> <code>0</code> — успех, больше нуля — команда
                отработала с ошибкой; это не отказ API.
              </li>
              <li>
                <strong>Терминал в кабинете — честная надстройка.</strong> Каждая строка уходит отдельным
                запросом; это не постоянный терминал на сервере, и это подписано в интерфейсе.
              </li>
            </ul>
          </section>

          <section class="site-section docs-section" id="site-ssh" aria-labelledby="site-ssh-title">
            <div class="site-section-head">
              <p class="site-eyebrow">Сайт и SSH</p>
              <h2 class="site-title" id="site-ssh-title">
                Приватный адрес, один порт и вход с компьютера
              </h2>
              <p class="site-lede">
                Своего публичного адреса у машины нет: снаружи видны только подписанная ссылка на один
                порт и SSH-шлюз. Поэтому сервер запускают внутри машины, а наружу открывают ровно тот
                порт, который он слушает.
              </p>
            </div>
            <ol class="docs-steps">
              <li class="docs-step">
                <span class="docs-step-number" aria-hidden="true">
                  1
                </span>
                <div>
                  <h3 class="docs-step-title">Запустите сервер в машине</h3>
                  <p class="docs-step-text">
                    Самый короткий пример — <code>python3 -m http.server 8000</code>: он отдаёт
                    каталог на порту 8000. Сервер живёт, пока жива команда, поэтому её оставляют в
                    терминале или запускают в отдельном сеансе.
                  </p>
                </div>
              </li>
              <li class="docs-step">
                <span class="docs-step-number" aria-hidden="true">
                  2
                </span>
                <div>
                  <h3 class="docs-step-title">Откройте порт в карточке машины</h3>
                  <p class="docs-step-text">
                    В блоке «Сайт» карточки машины укажите порт <code>8000</code> и нажмите «Открыть
                    сайт». Порты служб самой машины — <code>2280</code>, <code>2281</code>,{' '}
                    <code>22220</code> и <code>33333</code> — не выдаются: они заняты.
                  </p>
                </div>
              </li>
              <li class="docs-step">
                <span class="docs-step-number" aria-hidden="true">
                  3
                </span>
                <div>
                  <h3 class="docs-step-title">Пользуйтесь ссылкой до её срока</h3>
                  <p class="docs-step-text">
                    Ссылка открывает только этот порт и действует до указанного в ней времени. Она
                    сама является доступом, поэтому её не пересылают и не кладут в закладки надолго:
                    после окончания срока ссылка перестаёт работать, а новая выдаётся отдельным
                    действием.
                  </p>
                </div>
              </li>
            </ol>
            <CodeBlock
              label="curl: подписанная ссылка на порт 8000"
              code={`curl -sS -X POST "$ROX_API_URL/v1/sandboxes/$SANDBOX_ID/preview" \\
  -H "Authorization: Bearer $ROX_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"port":8000,"ttl_sec":3600}'

# {"object":"preview","port":8000,"url":"https://…","expires_at":"…"}`}
            />
            <p class="site-lede">
              Вход по SSH тоже выдаётся по запросу: кнопка «Создать доступ» в блоке SSH карточки
              машины возвращает готовую команду для терминала на компьютере. Внутри машины
              пользователь остаётся <code>daytona</code>, а команда действует ограниченное время и
              перестаёт работать вместе с машиной.
            </p>
            <p class="site-note site-note--plain">
              Постоянного адреса и своего SSH-ключа мы не обещаем: шлюз принимает только выданную
              команду, поэтому запись в <code>authorized_keys</code> сама по себе доступа не даёт.
              Адрес машины виден в блоке доступа и остаётся внутренним.
            </p>
            <div class="docs-actions">
              <A class="btn btn-secondary" href="/console/machines">
                Открыть машины
              </A>
            </div>
          </section>

          <section class="site-section docs-section" id="stop" aria-labelledby="stop-title">
            <div class="site-section-head">
              <p class="site-eyebrow">Остановка и удаление</p>
              <h2 class="site-title" id="stop-title">
                Остановить — закрыть счёт, удалить — вернуть остаток
              </h2>
              <p class="site-lede">
                Остановка закрывает резерв и считает фактическое время. Удаление убирает машину у
                поставщика и возвращает неиспользованный остаток; закрытая строка счёта остаётся.
              </p>
            </div>
            <CodeBlock
              label="curl: остановить и удалить"
              code={`curl -sS -X POST "$ROX_API_URL/v1/sandboxes/$SANDBOX_ID/stop" \\
  -H "Authorization: Bearer $ROX_API_KEY"

curl -sS -X DELETE "$ROX_API_URL/v1/sandboxes/$SANDBOX_ID" \\
  -H "Authorization: Bearer $ROX_API_KEY"`}
            />
            <p class="site-lede">
              Срок жизни исполняется сервером: когда <code>expires_at</code> прошёл, машина
              останавливается обычным путём и плата прекращается. Расход по клиенту —{' '}
              <code>GET /v1/usage</code>, по одной строке на списание.
            </p>
          </section>

          <section class="site-section docs-section" id="keys" aria-labelledby="keys-title">
            <div class="site-section-head">
              <p class="site-eyebrow">Ключи и поставщики</p>
              <h2 class="site-title" id="keys-title">
                Ключ Rox и ключ вашего аккаунта
              </h2>
              <p class="site-lede">
                Ключ Rox выпускается с правами и показывается один раз. Гостевой ключ не может выпускать
                другие ключи и не может пополнять баланс. Ключ поставщика добавляется отдельно и хранится
                зашифрованным: в ответах только последние четыре символа и отпечаток.
              </p>
            </div>
            <CodeBlock
              label="curl: выпустить ключ"
              code={`curl -sS -X POST "$ROX_API_URL/v1/keys" \\
  -H "Authorization: Bearer $ROX_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"scopes":["sandboxes:read","sandboxes:write","billing:read"]}'

# {"id":"key_…","api_key":"rox_sk_live_…","last4":"…","scopes":[…],"created_at":"…"}`}
            />
            <CodeBlock
              label="curl: добавить ключ поставщика"
              code={`curl -sS -X POST "$ROX_API_URL/v1/provider-credentials" \\
  -H "Authorization: Bearer $ROX_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"provider":"daytona","label":"моя команда","secret":"…","spendCapCents":5000}'`}
            />
            <ul class="site-list">
              <li>
                <strong>Секрет ключа поставщика не возвращается.</strong> После создания видны только{' '}
                <code>last4</code>, отпечаток, состояние и потолок расхода.
              </li>
              <li>
                <strong>Потолок расхода обязателен.</strong> <code>spendCapCents</code> — целое число
                центов; без него запрос отклоняется, потому что нулевой потолок читался бы как «не
                тратить».
              </li>
              <li>
                <strong>Свой ключ меняет только плату Rox.</strong> Машина идёт на вашем аккаунте, железо
                вы платите поставщику, а кошелёк списывает сервисный сбор за час. Класс Windows и кредиты
                GPU ключ не добавляет: их выдаёт поставщик в своём кабинете.
              </li>
            </ul>
          </section>

          <section class="site-section docs-section" id="errors" aria-labelledby="errors-title">
            <div class="site-section-head">
              <p class="site-eyebrow">Ошибки</p>
              <h2 class="site-title" id="errors-title">
                Один конверт на любой отказ
              </h2>
              <p class="site-lede">
                <code>request_id</code> в теле совпадает с заголовком <code>x-request-id</code>: его и
                называют при разборе. Ключи и заголовок Authorization в журнал не пишутся.
              </p>
            </div>
            <CodeBlock
              label="Конверт ошибки"
              code={`{
  "error": {
    "type": "invalid_request_error",
    "code": "invalid_request",
    "message": "product и snapshot взаимоисключающие: продукт уже называет снимок",
    "request_id": "req_…"
  }
}`}
            />
            <div class="error-table-wrap">
              <table class="error-table">
                <caption>
                  Коды, которые встречаются чаще всего. Отказ счёта приходит своим кодом, а не общим
                  «нужна оплата».
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Код</th>
                    <th scope="col">Статус</th>
                    <th scope="col">Что значит</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={ERROR_ROWS}>
                    {(row) => (
                      <tr>
                        <td data-label="Код">
                          <code>{row.code}</code>
                        </td>
                        <td data-label="Статус" class="error-status">
                          {row.status}
                        </td>
                        <td data-label="Что значит">{row.meaning}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
            <p class="site-lede">
              Разбор отказа начинается с номера запроса. Если поставщик недоступен, ответ —{' '}
              <code>provider_error</code>; состояние самого API и живые происшествия — на странице{' '}
              <A href="/status">«Состояние»</A>.
            </p>
          </section>
        </div>
      </div>

      <section class="site-cta-band" aria-labelledby="docs-cta">
        <div>
          <h2 id="docs-cta">Первая машина — без чтения всего раздела</h2>
          <p>Кабинет сам подставит продукт и откроет терминал.</p>
        </div>
        <div class="site-cta-actions">
          <A class="btn btn-primary" href="/console?guest=1">
            Запустить машину
          </A>
          <A class="btn btn-secondary" href="/pricing">
            Цены за час
          </A>
        </div>
      </section>
    </div>
  )
}
