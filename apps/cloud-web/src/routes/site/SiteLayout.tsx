import { A, useLocation } from '@solidjs/router'
import type { RouteSectionProps } from '@solidjs/router'
import { For } from 'solid-js'

import './site.css'

interface NavLink {
  readonly href: string
  readonly label: string
  /** Route links use the router; the product list is an anchor on the home page. */
  readonly route?: boolean
  readonly end?: boolean
}

const NAV: readonly NavLink[] = [
  { href: '/#products', label: 'Продукты' },
  { href: '/pricing', label: 'Цены', route: true },
  { href: '/docs', label: 'Документация', route: true },
  { href: '/status', label: 'Состояние', route: true },
]

const FOOTER_SITE: readonly { href: string; label: string; route?: boolean; end?: boolean }[] = [
  { href: '/', label: 'Главная', route: true, end: true },
  { href: '/#products', label: 'Продукты' },
  { href: '/pricing', label: 'Цены', route: true },
  { href: '/docs', label: 'Документация', route: true },
  { href: '/status', label: 'Состояние', route: true },
]

const FOOTER_WORK: readonly { href: string; label: string }[] = [
  { href: '/console?guest=1', label: 'Запустить машину' },
  { href: '/console', label: 'Войти по ключу' },
  { href: '/console/machines', label: 'Мои машины' },
  { href: '/console/invoice', label: 'Счёт' },
]

export default function SiteLayout(props: RouteSectionProps) {
  const location = useLocation()
  return (
    <div class="site-shell">
      <a class="skip-link" href="#main">
        К содержанию
      </a>
      <header class="site-header">
        <div class="site-header-inner">
          <A href="/" class="site-brand" end aria-label="Rox Cloud, на главную">
            <span class="site-brand-mark" aria-hidden="true">
              R
            </span>
            Rox Cloud
          </A>
          <nav class="site-nav" aria-label="Разделы сайта">
            <For each={NAV}>
              {(link) =>
                link.route === true ? (
                  <A href={link.href} end={link.end} activeClass="is-active">
                    {link.label}
                  </A>
                ) : (
                  <a href={location.pathname === '/' ? '#products' : link.href}>{link.label}</a>
                )
              }
            </For>
          </nav>
          <div class="site-header-actions">
            <A href="/console" class="btn btn-secondary btn-sm">
              Войти
            </A>
            <A href="/console?guest=1" class="btn btn-primary btn-sm">
              Купить
            </A>
          </div>
        </div>
      </header>
      <main class="site-main" id="main">
        <div class="site-content">{props.children}</div>
      </main>
      <footer class="site-footer">
        <div class="site-footer-inner">
          <div class="site-footer-brand">
            <A href="/" class="site-brand" end>
              <span class="site-brand-mark" aria-hidden="true">
                R
              </span>
              Rox Cloud
            </A>
            <p class="site-footer-note">
              Машины по часам: Linux, Windows и видеокарты. Один экран, терминал в браузере, свой ключ
              поставщика по желанию.
            </p>
          </div>
          <nav class="site-footer-nav" aria-label="Сайт">
            <p class="site-footer-title">Сайт</p>
            <For each={FOOTER_SITE}>
              {(link) =>
                link.route === true ? (
                  <A href={link.href} end={link.end}>
                    {link.label}
                  </A>
                ) : (
                  <a href={location.pathname === '/' ? '#products' : link.href}>{link.label}</a>
                )
              }
            </For>
          </nav>
          <nav class="site-footer-nav" aria-label="Кабинет">
            <p class="site-footer-title">Кабинет</p>
            <For each={FOOTER_WORK}>{(link) => <A href={link.href}>{link.label}</A>}</For>
          </nav>
        </div>
        <div class="site-footer-bottom">
          <p>
            Rox Cloud, 2026. Цены в долларах США, плата идёт за время работы машины. Rox не заявляет чужих
            сертификатов: аттестации, если они есть, относятся к площадкам поставщиков.
          </p>
          <p>Ключ Rox показывается один раз, а ключи поставщиков не попадают в журнал и ответы API.</p>
        </div>
      </footer>
    </div>
  )
}
