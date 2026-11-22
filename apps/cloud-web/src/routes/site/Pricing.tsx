import { A } from '@solidjs/router'
import { For, Show } from 'solid-js'
import type { JSX } from 'solid-js'
import { formatCents } from '@pricing'

import { CodeBlock, PageHeader } from '@/components'

import {
  AVAILABLE_PRODUCTS,
  DAYTONA_CONSOLE_URL,
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
import './pricing.css'

function osLabel(product: SiteProduct): string {
  if (product.gpu !== undefined) return 'Linux · видеокарта'
  return product.os === 'windows' ? 'Windows' : 'Linux'
}

export default function SitePricing(): JSX.Element {
  return (
    <div class="page pricing-page">
      <PageHeader
        eyebrow="Цены"
        title="Цены за час"
        description="Сейчас запускаются три Linux-машины. Windows и видеокарта H100 показаны с составом и ценой, но помечены «По запросу»: у этой организации Daytona нет класса Windows и кредитов GPU. Цена считается по составу машины, снимок уже несёт процессор, память и диск."
        actions={
          <>
            <a class="btn btn-secondary" href="#formula">
              Формула
            </a>
            <A class="btn btn-primary" href="/console?guest=1">
              Купить
            </A>
          </>
        }
      />

      <section class="site-section" aria-labelledby="table-title">
        <div class="site-section-head">
          <p class="site-eyebrow">Прайс</p>
          <h2 class="site-title" id="table-title">
            {AVAILABLE_PRODUCTS.length}{' '}
            {pluralRu(AVAILABLE_PRODUCTS.length, ['машина', 'машины', 'машин'])} запускаются,{' '}
            {REQUEST_PRODUCTS.length}{' '}
            {pluralRu(REQUEST_PRODUCTS.length, ['конфигурация', 'конфигурации', 'конфигураций'])} — по
            запросу
          </h2>
          <p class="site-lede">
            Сейчас можно купить и запустить три Linux-машины; Windows и H100 видны для справки. Первая
            цена — полная, когда машина идёт на платформенном ключе Rox. Вторая — только сервисный сбор,
            когда машина идёт на вашем ключе поставщика, а железо вы платите ему напрямую.
          </p>
        </div>
        <div class="price-table-wrap">
          <table class="price-table">
            <caption>
              Цены в долларах США за час работы. Строки «По запросу» показывают состав и цену для
              справки: запуск зависит от класса и квоты организации Daytona.
            </caption>
            <thead>
              <tr>
                <th scope="col">Продукт</th>
                <th scope="col">Состав</th>
                <th scope="col">Снимок</th>
                <th scope="col" class="num">
                  Цена за час
                </th>
                <th scope="col" class="num">
                  Со своим ключом
                </th>
                <th scope="col">Запуск</th>
              </tr>
            </thead>
            <tbody>
              <For each={SITE_PRODUCTS}>
                {(product) => (
                  <tr classList={{ 'is-request': !product.available }}>
                    <th scope="row" data-label="Продукт">
                      <span class="price-name">{product.name}</span>
                      <span class="price-os">{osLabel(product)}</span>
                      <Show when={product.providerNote}>
                        {(note) => <span class="price-note">{note()}</span>}
                      </Show>
                    </th>
                    <td data-label="Состав">
                      {cpuText(product.cpu)} · {memoryText(product.memoryGb)} · {diskText(product.diskGb)}
                      <Show when={product.gpu}>
                        {(gpu) => <span class="price-gpu"> · видеокарта {gpuText(gpu())}</span>}
                      </Show>
                    </td>
                    <td data-label="Снимок">
                      <span class="price-snapshot">{product.snapshotLabel}</span>
                    </td>
                    <td data-label="Цена за час" class="num">
                      <strong>{formatCents(product.retail)}</strong>
                      <span class="price-unit">/ч</span>
                    </td>
                    <td data-label="Со своим ключом" class="num">
                      {formatCents(product.fee)}
                      <span class="price-unit">/ч</span>
                    </td>
                    <td class="price-action" data-label="Запуск">
                      <Show
                        when={product.available}
                        fallback={<span class="price-request">По запросу</span>}
                      >
                        <A
                          class="btn btn-primary btn-sm"
                          href={`/console?plan=${product.id}&guest=1`}
                          aria-label={`Купить ${product.name}`}
                        >
                          Купить
                        </A>
                      </Show>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
        <p class="site-note">
          <strong>Сервисный сбор — это плата Rox, а не наценка на железо.</strong> Со своим ключом
          поставщика счёт за машину приходит вам от него по вашему тарифу; Rox выставляет только сбор за
          час. Без своего ключа работает платформенный, и кошелёк платит полную цену.
        </p>
        <p class="site-note site-note--plain">
          <strong>Windows и H100 — по запросу.</strong> На этой организации Daytona нет класса Windows и
          кредитов GPU, поэтому у этих строк нет кнопки запуска. Класс и квоты выдаёт поставщик: проверьте{' '}
          <a href={DAYTONA_CONSOLE_URL} target="_blank" rel="noopener noreferrer">
            кошелёк и квоты Daytona
          </a>.
        </p>
      </section>

      <section class="site-section" id="formula" aria-labelledby="formula-title">
        <div class="site-section-head">
          <p class="site-eyebrow">Формула</p>
          <h2 class="site-title" id="formula-title">
            Из чего получается цена часа
          </h2>
          <p class="site-lede">
            Считаем в целых центах и округляем вверх один раз, в конце. Поэтому в счёте не появляется
            дробных остатков, а цена в карточке совпадает с той, что спишет кабинет.
          </p>
        </div>
        <CodeBlock
          label="Цена часа, центы"
          code={`цена за час = 10 + 6 × ядра + 3 × ГБ памяти + 0,2 × ГБ диска + видеокарта
всё в центах; результат округляется вверх до целого цента

видеокарта: H100 = 300, L4 = 90, A10 = 120, T4 = 60
неизвестная карта считается как A10 = 120, а не бесплатно

сервисный сбор со своим ключом = max(5, round(цена × 0,15))`}
        />
        <div class="formula-example">
          <p class="formula-example-title">Проверка на «Разработке»</p>
          <p class="formula-math">
            10 + 6×2 + 3×4 + 0,2×8 = 35,6 → округляем вверх → 36 ¢/ч = 0,36 $/ч
          </p>
          <p class="formula-note">
            Своим ключом поставщика: max(5, round(36 × 0,15)) = 5 ¢/ч, то есть 0,05 $/ч. У H100 сбор
            больше: 118 ¢/ч, или 1,18 $/ч.
          </p>
        </div>
      </section>

      <section class="site-section" aria-labelledby="modes-title">
        <div class="site-section-head">
          <p class="site-eyebrow">Два режима оплаты</p>
          <h2 class="site-title" id="modes-title">
            Чей ключ запускает машину
          </h2>
          <p class="site-lede">
            Режим виден в карточке машины и в счёте. Переключить его можно, только добавив или убрав
            свой ключ поставщика; задним числом цена не меняется.
          </p>
        </div>
        <div class="modes-grid">
          <div class="mode-card">
            <h3 class="mode-title">Платформенный ключ Rox</h3>
            <p class="mode-text">
              Машина запускается на ключе Rox у поставщика. Кошелёк платит полную цену часа из таблицы,
              а машина и площадка выбираются в кабинете. Так работает пробный запуск — свой ключ для
              него не нужен.
            </p>
            <p class="mode-tag">Полная цена часа</p>
          </div>
          <div class="mode-card mode-card--accent">
            <h3 class="mode-title">Свой ключ поставщика</h3>
            <p class="mode-text">
              Вы добавляете ключ своего аккаунта Daytona в кабинете. Машина идёт на нём, железо вы
              платите поставщику по своему тарифу, а кошелёк Rox списывает только сервисный сбор. Класс
              Windows и кредиты GPU ключ не добавляет: их выдаёт поставщик.
            </p>
            <p class="mode-tag">Только сервисный сбор</p>
          </div>
        </div>
      </section>

      <section class="site-section" aria-labelledby="trial-title-pricing">
        <div class="site-section-head">
          <p class="site-eyebrow">Пробный счёт</p>
          <h2 class="site-title" id="trial-title-pricing">
            {formatCents(TRIAL_CENTS)} на счёте, карта не нужна
          </h2>
          <p class="site-lede">
            Пробный баланс — настоящие деньги на кошельке, а не скидка. Их хватает на первые запуски, а
            потолки не дают счёту уйти в бесконечность.
          </p>
        </div>
        <div class="trial-grid">
          <div class="trial-card">
            <p class="trial-amount">{formatCents(TRIAL_CENTS)}</p>
            <p class="trial-note">Пополнять сам гость не может: баланс меняет дежурный.</p>
            <ul class="site-list">
              <li>Одна машина одновременно, до 16 ядер.</li>
              <li>Срок одного запуска — до 24 часов.</li>
              <li>Расход — не больше {formatCents(TRIAL_CENTS)} в месяц.</li>
              <li>Ключ Rox живёт в памяти вкладки и исчезает вместе с ней.</li>
            </ul>
          </div>
          <div class="trial-card trial-card--plain">
            <h3 class="trial-title">За что мы не берём денег</h3>
            <ul class="site-list">
              <li>За регистрацию, вход и выпуск гостевого ключа.</li>
              <li>За хранение ключа поставщика и его отпечатка.</li>
              <li>За остановку, удаление машины и просмотр счёта.</li>
              <li>За подписку и минимальный платёж: их нет.</li>
              <li>За время, пока машина остановлена: счётчик стоит.</li>
            </ul>
            <p class="trial-fine">
              Отдельно придёт только счёт поставщика за железо — и только если машина шла на вашем
              ключе. Rox в этой оплате не участвует.
            </p>
          </div>
        </div>
      </section>

      <section class="site-section" aria-labelledby="billing-title">
        <div class="site-section-head">
          <p class="site-eyebrow">Списание</p>
          <h2 class="site-title" id="billing-title">
            Как деньги двигаются по кошельку
          </h2>
        </div>
        <ol class="billing-steps">
          <li class="billing-step">
            <span class="billing-number" aria-hidden="true">
              1
            </span>
            <p>
              При запуске резервируется плата за весь заявленный срок по ставке этой машины. Не хватает
              денег или лимита — запрос отклоняется своим кодом, а не общим «нужна оплата».
            </p>
          </li>
          <li class="billing-step">
            <span class="billing-number" aria-hidden="true">
              2
            </span>
            <p>
              При остановке резерв закрывается, списывается фактическое время работы. Строка счёта
              хранит снимок, режим, ставку и время — её можно выгрузить в CSV.
            </p>
          </li>
          <li class="billing-step">
            <span class="billing-number" aria-hidden="true">
              3
            </span>
            <p>
              Удаление возвращает неиспользованный остаток резерва на кошелёк, но не стирает уже
              закрытую строку счёта.
            </p>
          </li>
          <li class="billing-step">
            <span class="billing-number" aria-hidden="true">
              4
            </span>
            <p>
              Когда истекает срок, машина останавливается сама — тем же путём, что и по кнопке. Данные
              внутри неё после этого не гарантированы.
            </p>
          </li>
        </ol>
        <p class="site-note site-note--plain">
          Проверить начисления можно в кабинете и запросом <code>GET /v1/usage</code>: одна строка на
          списание, в целых центах. Формат ответа описан в <A href="/docs">документации</A>.
        </p>
      </section>

      <section class="site-cta-band" aria-labelledby="pricing-cta">
        <div>
          <h2 id="pricing-cta">Сначала — одна машина</h2>
          <p>Пробный счёт открывается без карты и пароля.</p>
        </div>
        <div class="site-cta-actions">
          <A class="btn btn-primary" href="/console?guest=1">
            Запустить машину
          </A>
          <A class="btn btn-secondary" href="/docs">
            Как это сделать
          </A>
        </div>
      </section>
    </div>
  )
}
