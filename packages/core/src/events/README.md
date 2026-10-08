# `@rox/core/events` — domain events → realtime (W1-03, #1500)

Domain events are projected into realtime publications (`projection.ts`),
sequenced per topic with a bounded replay window (`sequence.ts`, `TopicLog`)
and delivered by the in-process event bus / workspace realtime gateway.
Clients track `(epoch, seq)` per topic (`TopicSeqTracker`) and recover gaps by
resubscribing with `sinceSeq` + `epoch`, or refetch on `snapshot_required`.

Log lifetime (server-core `InProcessEventBus`):

- idle workspace logs are dropped by `evictIdle()` unless retained — the
  realtime gateway retains every workspace with a live subscription, so a quiet
  but connected workspace still answers `up_to_date` on resubscribe;
- a log holding more than `maxSeqCountersPerWorkspace` (default 50 000) seq
  counters is rotated even when retained;
- a dropped or rotated log comes back with a new epoch, so held positions get
  one `snapshot_required` per topic; a `sinceSeq > 0` sent without an epoch is
  always `snapshot_required`.

## UNDONE

- **Projectors must be total and tested (W1-06 and every module projector).**
  The failure fallback only reaches the subject's `entity:{kind}:{id}` topic
  (ids-only refetch frame), and nothing when the event has no subject. A
  projector that throws therefore silently loses the frames it meant for
  `channel:`, `task-list:`, `space:`, `calendar:` or `user:` topics; no seq is
  consumed, so subscribers see no gap. The contract is documented on
  `EventProjector` in `projection.ts`; there is no runtime guard beyond the
  `ProjectorError` report.
- Workspace logs are retained only while the gateway has live subscriptions.
  A client that disconnects (e.g. laptop sleep) and returns after the idle TTL
  with no other live subscriber in the workspace still gets `snapshot_required`
  and refetches; persisted resume cursors do not keep a log alive.
