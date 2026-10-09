import ConnectionsPage from '@/pages/ConnectionsPage'

/**
 * «Подключения» — the canonical connections fabric (services / credentials /
 * imports / policies / audit), reused as-is. Its service tab renders the same
 * `ConnectionsOverview` the standalone route does.
 */
export default function ConnectionsSection() {
  return <ConnectionsPage />
}