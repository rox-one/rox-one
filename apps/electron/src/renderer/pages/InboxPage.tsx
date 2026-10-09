/**
 * Входящие route entry (W3.1, D4). The queue was merged into Лента, so this
 * page is a thin wrapper that opens the merged Feed screen with the
 * «Входящие» section active — `routes.view.inbox()` therefore deep-links into
 * the Feed instead of a second, parallel screen. The queue body lives in
 * `pages/inbox/InboxQueue` and is reused verbatim by `FeedPage`.
 */
import FeedPage from './FeedPage'

export default function InboxPage({ selectedId }: { selectedId?: string | null }) {
  return <FeedPage section="inbox" selectedId={selectedId} />
}