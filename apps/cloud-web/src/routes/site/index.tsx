import { A } from '@solidjs/router'
import { For, Show, onMount } from 'solid-js'
import type { JSX } from 'solid-js'
import { MIN_SERVICE_FEE_CENTS_PER_HOUR, formatCents } from '@pricing'

import { CodeBlock } from '@/components'

import {
  AVAILABLE_PRODUCTS,
  LIVE_REGION,
  REQUEST_PRODUCTS,
  SITE_PRODUCTS,
  TRIAL_CENTS,
  cpuText,
  diskText,
  gpuText,
  memoryText,
  pluralRu,
} from './products'
import type { SiteProduct } from './products'
import './index.css'

/** `TRIAL_CENTS / hourly` hours, or `null` when this build does not sell the id. */
function trialHours(id: string): number | null {
  const product = SITE_PRODUCTS.find((entry) => entry.id === id)
  if (product === undefined || product.retail <= 0) return null
  return Math.floor(TRIAL_CENTS / product.retail)
}

const MINI_HOURS = trialHours('linux-start')
const STANDARD_HOURS = trialHours('linux-pro')

/** One-line use case per live plan, keyed by the price-list id. */
const PLAN_HINTS: Readonly<Record<string, string>> = {
  'linux-start': 'Скрипты, учёба и проверка идеи.',
  'linux-pro': 'Основная машина: разработка и небольшие сборки.',
  'linux-large': 'Сборки, тесты и несколько сервисов сразу.',
}

function ProductCard(props: { product: SiteProduct }): JSX.Element {
  const product = (): SiteProduct => props.product
  return (
    <article class="product-card">
      <div class="product-card-head">
        <h4 class="product-name">{product().name}</h4>
        <span class="product-tag">{product().os === 'windows' ? 'Windows' : 'Linux'}</span>
      </div>
      <p class="product-snapshot">{product().snapshotLabel}</p>
      <p class="product-hint">
        {PLAN_HINTS[product().id] ?? 'Готовая машина с терминалом в браузере.'}
      </p>
      <ul class="product-specs" aria-label="Состав машины">
        <li>{cpuText(product().cpu)}</li>
        <li>{memoryText(product().memoryGb)}</li>
        <li>{diskText(product().diskGb)}</li>
        <Show when={product().gpu}>
          {(gpu) => <li class="product-gpu">Видеокарта {gpuText(gpu())}</li>}
        </Show>
      </ul>
      <div class="product-card-foot">
        <p class="product-price">
          <span class="product-price-value">{formatCents(product().retail)}</span>
          <span class="product-price-unit">/час</span>
        </p>
        <p class="product-fee">
          Со своим ключом — только сервисный сбор <strong>{formatCents(product().fee)}/ч</strong>.
        </p>
        <A
          class="btn btn-primary btn-block"
          href={`/console?plan=${product().id}&guest=1`}
          aria-label={`Купить ${product().name}`}
        >
          Купить
        </A>
      </div>
    </article>
  )
}

export default function SiteHome(): JSX.Element {
  onMount(() => {
    // A full page load to `/#products` arrives before the section exists, so
    // the browser's own fragment jump can miss it. Repeat it once, after paint.
    if (window.location.hash === '#products') {
      document.getElementById('products')?.scrollIntoView({ block: 'start' })
    }
  })

  return (
    <div class="page home-page">
      <section class="hero" aria-labelledby="hero-title">
        <div class="hero-copy">
          <p class="site-eyebrow">Rox Cloud</p>
          <h1 class="hero-title" id="hero-title">
            Машина в облаке за минуту. Платите за час.
          </h1>
          <p class="hero-lede">
            Три Linux-машины запускаются прямо сейчас: выбираете состав на одном экране, запускаете и
            работаете в терминале прямо в браузере. Windows и видеокарта — скоро. Регистрация не нужна —
            на пробном счёте уже лежит {formatCents(TRIAL_CENTS)}.
          </p>
          <div class="hero-actions">
            <A class="btn btn-primary btn-lg" href="/console?guest=1">
              Запустить машину
            </A>
            <A class="btn btn-secondary btn-lg" href="/pricing">
              Цены за час
            </A>
          </div>
          <ul class="hero-facts">
            <li>Готовая Linux-машина, а не пустая форма: образ задаёт процессор, память и диск</li>
            <li>Терминал в браузере: команда, ответ и код выхода на одном экране</li>
            <li>Свой ключ — тогда платите только сервисный сбор</li>
          </ul>
        </div>
        <aside class="hero-trial" aria-labelledby="trial-heading">
          <p class="site-eyebrow" id="trial-heading">
            Пробный счёт
          </p>
          <p class="hero-trial-amount">{formatCents(TRIAL_CENTS)}</p>
          <p class="hero-trial-note">
            <Show
              when={MINI_HOURS !== null && STANDARD_HOURS !== null}
              fallback="Хватает на первые запуски."
            >
              Хватает на {MINI_HOURS} {pluralRu(MINI_HOURS ?? 0, ['час', 'часа', 'часов'])} машины
              «Мини» или на {STANDARD_HOURS} {pluralRu(STANDARD_HOURS ?? 0, ['час', 'часа', 'часов'])}{' '}
              машины «Стандарт».
            </Show>
          </p>
          <ul class="hero-trial-limits">
            <li>Карта не нужна</li>
            <li>Одна машина одновременно</li>
            <li>До 16 ядер</li>
            <li>Один запуск — до 24 часов</li>
          </ul>
          <A class="btn btn-secondary btn-block" href="/console?guest=1">
            Открыть кабинет
          </A>
          <p class="hero-trial-fine">
            Это гостевой вход: ключ живёт только в этой вкладке и исчезает, когда вы её закроете.
          </p>
        </aside>
      </section>

      <section class="site-section" id="products" aria-labelledby="products-title">
        <div class="site-section-head">
          <p class="site-eyebrow">Продукты</p>
          <h2 class="site-title" id="products-title">
            {AVAILABLE_PRODUCTS.length}{' '}
            {pluralRu(AVAILABLE_PRODUCTS.length, ['машина', 'машины', 'машин'])} Linux запускаются сейчас
          </h2>
          <p class="site-lede">
            Цена считается по составу машины: образ задаёт процессор, память и диск, поэтому счёт
            совпадает с карточкой. Все три запускаются в площадке <code>{LIVE_REGION}</code>. Со своим
            ключом машина идёт на вашем ключе, а Rox берёт только сервисный сбор — он указан в каждой
            карточке.
          </p>
        </div>
        <ul class="product-grid product-grid--live">
          <For each={AVAILABLE_PRODUCTS}>
            {(product) => (
              <li class="product-item">
                <ProductCard product={product} />
              </li>
            )}
          </For>
        </ul>
        <div class="soon-band" role="group" aria-labelledby="soon-title">
          <div class="soon-head">
            <div class="soon-head-copy">
              <h3 class="soon-title" id="soon-title">
                Скоро
              </h3>
              <p class="soon-lede">
                Windows и машины с видеокартой сейчас в работе. Состав и цена уже известны — запуск
                появится в этом же кабинете.
              </p>
            </div>
            <A class="btn btn-secondary btn-sm" href="/console">
              Открыть кабинет
            </A>
          </div>
          <ul class="soon-list">
            <For each={REQUEST_PRODUCTS}>
              {(product) => (
                <li class="soon-item">
                  <div class="soon-item-main">
                    <p class="soon-name">{product.name}</p>
                    <p class="soon-specs">
                      {cpuText(product.cpu)} · {memoryText(product.memoryGb)} · {diskText(product.diskGb)}
                      <Show when={product.gpu}>
                        {(gpu) => <span> · {gpuText(gpu())}</span>}
                      </Show>
                    </p>
                  </div>
                  <div class="soon-item-side">
                    <p class="soon-price">
                      {formatCents(product.retail)}
                      <span class="soon-unit">/час</span>
                    </p>
                    <span class="soon-badge">Скоро</span>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </div>
        <p class="site-note">
          <strong>Свой ключ — это ключ вашего облачного аккаунта.</strong> Машина запускается на нём,
          железо вы оплачиваете там же, а Rox берёт только сервисный сбор. Без своего ключа работает
          платформенный: так устроен и пробный запуск.
        </p>
      </section>

      <section class="site-section" aria-labelledby="steps-title">
        <div class="site-section-head">
          <p class="site-eyebrow">Как это работает</p>
          <h2 class="site-title" id="steps-title">
            Три шага до работающей машины
          </h2>
          <p class="site-lede">
            Один экран кабинета вместо переключения между чужими панелями. Цена часа и остаток видны до
            нажатия «Запустить».
          </p>
        </div>
        <ol class="step-list">
          <li class="step">
            <span class="step-number" aria-hidden="true">
              1
            </span>
            <h3 class="step-title">Откройте кабинет</h3>
            <p class="step-text">
              Кнопка «Купить» создаёт гостевой вход с {formatCents(TRIAL_CENTS)} на счёте: без пароля,
              карты и письма. Если гостевой вход выключен, кабинет попросит ключ и объяснит, где его
              взять.
            </p>
          </li>
          <li class="step">
            <span class="step-number" aria-hidden="true">
              2
            </span>
            <h3 class="step-title">Выберите машину</h3>
            <p class="step-text">
              Продукт, площадка и срок — на одном экране. Цена часа, резерв за срок и остаток после
              запуска пересчитываются сразу; точный состав берётся из образа.
            </p>
          </li>
          <li class="step">
            <span class="step-number" aria-hidden="true">
              3
            </span>
            <h3 class="step-title">Работайте и остановите</h3>
            <p class="step-text">
              Терминал открывается вместе с машиной: команды, ответ и код выхода. Остановка закрывает
              счёт по фактическому времени, а истёкший срок останавливает машину без вас.
            </p>
          </li>
        </ol>
      </section>

      <section class="site-section" aria-labelledby="included-title">
        <div class="site-section-head">
          <p class="site-eyebrow">Что входит</p>
          <h2 class="site-title" id="included-title">
            Всё, что делает машину продуктом
          </h2>
          <p class="site-lede">
            Плата за час — это не только железо. В неё входит то, что превращает облачное железо в
            один понятный инструмент.
          </p>
        </div>
        <ul class="included-grid">
          <li class="included-item">
            <h3 class="included-title">Терминал в браузере</h3>
            <p class="included-text">
              Без ssh и установки клиента: команда уходит на машину, stdout и stderr показаны разными
              цветами, код выхода больше нуля — красной пометкой. Терминал проверен на «Стандарте».
            </p>
          </li>
          <li class="included-item">
            <h3 class="included-title">Три готовых образа Linux</h3>
            <p class="included-text">
              «Мини», «Стандарт» и «Про» запускаются сейчас. Windows и машины с видеокартой — в работе:
              состав и цена уже видны, запуск появится позже.
            </p>
          </li>
          <li class="included-item">
            <h3 class="included-title">Площадка <code>us</code></h3>
            <p class="included-text">
              Все три доступные машины запускаются в общей площадке <code>us</code>. Другую площадку мы
              пока не проверяли, поэтому не обещаем.
            </p>
          </li>
          <li class="included-item">
            <h3 class="included-title">Счёт по часам</h3>
            <p class="included-text">
              У каждой машины своя ставка: резерв при старте, списание по факту остановки, строка в счёте
              с составом и режимом оплаты.
            </p>
          </li>
          <li class="included-item">
            <h3 class="included-title">Ключи без секретов в ответах</h3>
            <p class="included-text">
              Ключ облака хранится на сервере, а API показывает только последние четыре символа и
              отпечаток. Ключ Rox живёт в памяти вкладки.
            </p>
          </li>
          <li class="included-item">
            <h3 class="included-title">Журнал и выгрузка</h3>
            <p class="included-text">
              Кто, что и когда сделал с машиной, плюс счёт и журнал в CSV. Секретов в журнале нет — его
              можно показать коллеге.
            </p>
          </li>
        </ul>
      </section>

      <section class="site-section" aria-labelledby="curl-title">
        <div class="site-section-head">
          <p class="site-eyebrow">Из терминала</p>
          <h2 class="site-title" id="curl-title">
            Первая машина одним запросом
          </h2>
          <p class="site-lede">
            Тот же запуск, что и в кабинете: продукт и площадка в теле, ключ в заголовке. Ответ заберёт
            образ, площадку и ставку — подставлять ресурсы вручную не нужно.
          </p>
        </div>
        <CodeBlock
          label="curl: создать машину"
          code={`export ROX_API_KEY=rox_sk_live_…
export ROX_API_URL=http://localhost:8787

curl -sS -X POST "$ROX_API_URL/v1/sandboxes" \\
  -H "Authorization: Bearer $ROX_API_KEY" \\
  -H "Idempotency-Key: first-machine-1" \\
  -H "Content-Type: application/json" \\
  -d '{"product":"linux-pro","region":"us","ttlSec":3600}'`}
        />
        <p class="site-lede">
          Ответ содержит <code>id</code>, состояние, состав образа, площадку, ставку и режим оплаты.
          Вместо <code>product</code> можно передать <code>snapshot</code>; неизвестный образ сервер
          отклонит до списания. Этим запросом запускается машина Linux; Windows и видеокарта появятся
          позже. Полный разбор — в <A href="/docs">документации</A>.
        </p>
      </section>

      <section class="site-section" aria-labelledby="limits-title">
        <div class="site-section-head">
          <p class="site-eyebrow">Границы</p>
          <h2 class="site-title" id="limits-title">
            Что можно на пробном счёте и чего мы не обещаем
          </h2>
          <p class="site-lede">
            Пробный запуск — настоящий, но с потолками: они защищают счёт и вас, и нас. Всё, чего нет в
            кабинете, не обещано и на сайте.
          </p>
        </div>
        <div class="limits-grid">
          <div class="limits-card">
            <h3 class="limits-title">Пробный счёт</h3>
            <ul class="site-list">
              <li>
                <strong>{formatCents(TRIAL_CENTS)} на счёте</strong> — карта, пароль и письмо не нужны.
              </li>
              <li>Одна машина одновременно и не больше 16 ядер.</li>
              <li>Срок одного запуска — до 24 часов.</li>
              <li>Расход гостя — не больше {formatCents(TRIAL_CENTS)} в месяц.</li>
              <li>Ключ Rox живёт в этой вкладке и не попадает в адресную строку.</li>
            </ul>
          </div>
          <div class="limits-card limits-card--muted">
            <h3 class="limits-title">Чего не обещаем</h3>
            <ul class="site-list">
              <li>
                Windows и машины с видеокартой — скоро: цена и состав уже известны, запуск не обещан.
              </li>
              <li>Данные внутри машины не гарантированы после остановки — забирайте нужное до конца срока.</li>
              <li>Пробный счёт не пополняется сам: когда деньги кончатся, новые машины не запустятся.</li>
              <li>Если запуск отказал, придёт <code>provider_error</code> с номером запроса, а не ложный успех.</li>
            </ul>
          </div>
        </div>
      </section>

      <section class="site-section" aria-labelledby="faq-title">
        <div class="site-section-head">
          <p class="site-eyebrow">Вопросы</p>
          <h2 class="site-title" id="faq-title">
            Коротко о том, что спрашивают чаще всего
          </h2>
        </div>
        <div class="site-faq">
          <details class="faq-item">
            <summary>Нужна ли регистрация и банковская карта?</summary>
            <p>
              Нет. Кнопка «Купить» открывает кабинет, создаёт гостевой ключ и кладёт{' '}
              {formatCents(TRIAL_CENTS)}. Ключ хранится только в памяти вкладки: закрыли вкладку — он
              забыт.
            </p>
          </details>
          <details class="faq-item">
            <summary>На сколько хватит пробных {formatCents(TRIAL_CENTS)}?</summary>
            <p>
              Это арифметика по прайсу: {MINI_HOURS ?? 0} часов машины «Мини» или{' '}
              {STANDARD_HOURS ?? 0} часов «Стандарт». Один запуск длится не больше 24 часов, поэтому
              часы можно распределить между несколькими запусками.
            </p>
          </details>
          <details class="faq-item">
            <summary>Чем «свой ключ» отличается от платформенного?</summary>
            <p>
              Свой ключ — это ключ вашего облачного аккаунта. Машина идёт на нём, железо вы оплачиваете
              там же по своему тарифу, а Rox берёт только сервисный сбор: 15 % цены часа, но не меньше{' '}
              {formatCents(MIN_SERVICE_FEE_CENTS_PER_HOUR)}. Без своего ключа работает платформенный, и
              кошелёк платит полную цену часа.
            </p>
          </details>
          <details class="faq-item">
            <summary>Где хранится ключ Rox и ключ облака?</summary>
            <p>
              Ключ Rox — в памяти вкладки (<code>sessionStorage</code>), не в адресной строке и не в
              cookie. Ключ облака хранится на сервере, а ответы API показывают только последние четыре
              символа и отпечаток.
            </p>
          </details>
          <details class="faq-item">
            <summary>Можно ли запустить Windows или машину с видеокартой?</summary>
            <p>
              Пока нет — они в работе. Состав и цена уже видны на странице <A href="/pricing">«Цены»</A>{' '}
              с пометкой «Скоро», а запуск появится в этом же кабинете.
            </p>
          </details>
          <details class="faq-item">
            <summary>Что делать, если API не отвечает?</summary>
            <p>
              Откройте страницу <A href="/status">«Состояние»</A>: она проверяет <code>/health</code> и
              показывает живые происшествия. Отказы API приходят с номером запроса — назовите его
              поддержке, ключи пересылать не нужно.
            </p>
          </details>
        </div>
      </section>

      <section class="site-cta-band" aria-labelledby="cta-title">
        <div>
          <h2 id="cta-title">Первая машина — за минуту</h2>
          <p>Пробный счёт уже открыт. Карта не нужна.</p>
        </div>
        <div class="site-cta-actions">
          <A class="btn btn-primary" href="/console?guest=1">
            Запустить машину
          </A>
          <A class="btn btn-secondary" href="/docs">
            Документация
          </A>
        </div>
      </section>
    </div>
  )
}
