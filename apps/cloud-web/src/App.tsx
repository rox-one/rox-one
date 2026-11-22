import { A, Route, Router } from '@solidjs/router'
import { Suspense, lazy } from 'solid-js'
import type { JSX } from 'solid-js'

import { EmptyState, Skeleton, ToastProvider } from './components'

const SiteLayout = lazy(() => import('./routes/site/SiteLayout'))
const SiteHome = lazy(() => import('./routes/site'))
const SitePricing = lazy(() => import('./routes/site/Pricing'))
const SiteDocs = lazy(() => import('./routes/site/Docs'))
const SiteStatus = lazy(() => import('./routes/site/Status'))

const ConsoleLayout = lazy(() => import('./routes/console/ConsoleLayout'))
const ConsoleProducts = lazy(() => import('./routes/console'))
const ConsoleMachines = lazy(() => import('./routes/console/Machines'))
const ConsoleMachine = lazy(() => import('./routes/console/Machine'))
const ConsoleInvoice = lazy(() => import('./routes/console/Invoice'))
const ConsoleKeys = lazy(() => import('./routes/console/Keys'))
const ConsoleJournal = lazy(() => import('./routes/console/Journal'))

const AdminLayout = lazy(() => import('./routes/admin/AdminLayout'))
const AdminOverview = lazy(() => import('./routes/admin'))
const AdminClients = lazy(() => import('./routes/admin/Clients'))
const AdminClient = lazy(() => import('./routes/admin/Client'))
const AdminMachines = lazy(() => import('./routes/admin/Machines'))
const AdminKeys = lazy(() => import('./routes/admin/Keys'))
const AdminLogs = lazy(() => import('./routes/admin/Logs'))
const AdminSupport = lazy(() => import('./routes/admin/Support'))
const AdminSecurity = lazy(() => import('./routes/admin/Security'))

function Root(props: { children?: JSX.Element }) {
  return (
    <Suspense
      fallback={
        <div class="boot">
          <Skeleton lines={4} />
        </div>
      }
    >
      {props.children}
    </Suspense>
  )
}

function NotFound() {
  return (
    <div class="container" style={{ 'padding-block': '64px' }}>
      <EmptyState
        icon="box"
        title="Страница не найдена"
        description="Такого адреса в Rox Cloud нет."
        action={
          <A href="/" class="btn btn-primary">
            На главную
          </A>
        }
      />
    </div>
  )
}

/**
 * One application, three surfaces. Nested layouts own the chrome; the page
 * files under `routes/` own the content and their own stylesheet.
 */
export default function App() {
  return (
    <ToastProvider>
      <Router root={Root}>
        <Route path="/" component={SiteLayout}>
          <Route path="/" component={SiteHome} />
          <Route path="pricing" component={SitePricing} />
          <Route path="docs" component={SiteDocs} />
          <Route path="status" component={SiteStatus} />
        </Route>

        <Route path="/console" component={ConsoleLayout}>
          <Route path="/" component={ConsoleProducts} />
          <Route path="machines" component={ConsoleMachines} />
          <Route path="machines/:id" component={ConsoleMachine} />
          <Route path="invoice" component={ConsoleInvoice} />
          <Route path="keys" component={ConsoleKeys} />
          <Route path="journal" component={ConsoleJournal} />
        </Route>

        <Route path="/admin" component={AdminLayout}>
          <Route path="/" component={AdminOverview} />
          <Route path="clients" component={AdminClients} />
          <Route path="clients/:id" component={AdminClient} />
          <Route path="machines" component={AdminMachines} />
          <Route path="keys" component={AdminKeys} />
          <Route path="logs" component={AdminLogs} />
          <Route path="support" component={AdminSupport} />
          <Route path="security" component={AdminSecurity} />
        </Route>

        <Route path="*" component={NotFound} />
      </Router>
    </ToastProvider>
  )
}
