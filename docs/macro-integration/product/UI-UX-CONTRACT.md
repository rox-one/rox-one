# UI/UX contract

Target requirements. Current evidence: ROX `e780e73ae84c977cf81546b49140d318dfcd6049`, `packages/ui/src/styles/index.css` semantic tokens/font presets; `ModeScreen.tsx` layout; `platform-contract.ts` ref/status. Leaf controls defined in screen catalogs.

## Layout

Single flush ROX shell/hairline dividers. Current tokens: topbar40, rail44; desktop ModeScreen nav220/list min240/detail min320. Target list280–360 and flexible detail; <960 collapse list when detail open, <720 single pane/back. Current source не доказывает такой narrow behavior. Test1440×900/1280×800/768×1024/390×844.

Control visual density24/26px; target pointer hitbox≥32px, touch≥44px. Радиусы current4badge/6control/8group/10popover/12dialog. Inherit semantic background/foreground/surface/border/accent/error and selected accent/theme; source mint intent is a preset, not a forced replacement of the installed purple accent, no theme per surface. Font selection respected; record computed loaded font; Linux Arial Narrow fallback отличается от macOS. New global typography requires separate owned change.

Motion target120–160ms hover opacity/background,180–220ms panel; no row scale/layout shift; reduced-motion removes transforms. List/content independent scroll, header/composer pinned; overlays never cover focused control.

## Interactions

| Control | Hover | Focus | Click/Enter | Keyboard / help |
|---|---|---|---|---|
| list row | subtle tint + secondary actions fade120ms |2px ring; same actions | select canonical detail, retain filters | arrows/Enter; second panel shortcut only if implemented |
| entity chip | underline/accent; cached permitted peek after400ms | explicit focus/shortcut same peek | canonical route/context | Escape closes; hidden entities give no title |
| icon button | tint; tooltip500ms | ring + accessible label | one action, duplicate disabled pending | Space/Enter; tooltip Escape |
| favorite | tint, add/remove tooltip | aria-pressed | canonical ref preference, rollback error | no mutation on hover |
| share | audience explanation | same readable label | grants dialog, no auto-public | Escape cancels unsaved |
| sync badge | freshness/queue tooltip | help also click | status detail/retry | failure text persistent, not tooltip-only |
| presence avatar | authorized name/activity | same card | permitted participant actions | no private email disclosure |
| message toolbar | reply/react/task/link/overflow without shift | focus-within reveals | message ref command | channel Enter-send/ShiftEnter-newline; CRM rich discussion Enter-newline/CmdCtrlEnter-send; per-screen contract and explicit preference override generic default |
| drag | grab + valid targets | alternative Move button | preview then revisioned command | Escape cancel; keyboard move dialog |
| date/time | zone/recurrence explanation | labelled editable picker | local time+IANA zone+instant | DST ambiguity explicit |
| unavailable action | disabled + capability reason | separate help reachable | Connections alternative | no fake success |
| destructive | error tint | named action/ring | scoped confirmation + receipt | Enter not destructive default; Escape cancel |

Hover никогда не вызывает read mark, sharing, send, AI request или other mutation. Read requires policy-defined explicit viewing. Touch uses visible overflow. Every label `t()`/react-i18next, RU default;10 locale key parity/sorted/coverage. Currency units/period/source and timestamp offset/freshness explained on hover/focus/click.

## Forms

DraftId stable. Title trim/nonempty; richtext sanitized; pickers authorised/paginated/workspace-scoped, no hidden totals. Source prefill provenance visible. Submit field errors inline and focus first error; failure preserves draft. Output receipt/ref/revision/status distinguishes local saved, queued, applied, provider confirmed. Conflict expected/actual revision→compare/reload/copy; no silent overwrite outside explicitly CRDT content. Cancel after external dispatch не обещает undo.

## States

| State | UI / allowed action | Rejected behavior |
|---|---|---|
| loading | same-geometry skeleton, accessible status/back | premature empty |
| empty | purpose + create/connect/import CTA | mask permission failure |
| filtered_empty | active filters + reset | erase saved filters |
| forbidden/revoked | neutral denial/purge preview/request-access if permitted | old cached title/body/IPC bypass |
| offline_cached | offline + last verified time | live green badge |
| queued_local | unsent count/idempotent queue/copy/cancel | claim server persistence |
| pending_provider | correlation/status/refresh-reconcile | blind resend |
| unsupported | capability reason/settings link | enabled dead control |
| retryable_error | inline redacted ID/retry/draft retained | catch→[] |
| conflict | compare versions/copy/rebase | silent last-write-wins |
| processing | recording/preview/transcript/summary separate stages | one spinner implies readiness |
| verified | receipt/read-back freshness | eternal green after expiry |

## Permissions and accessibility

UI visibility is not enforcement. Viewer keyboard/tools denied server-side. Mention не auto-share. Grants dialog distinguishes inherited/direct/expiry. Revoke final only after delivery fence receipt. Downloads proxy or residual TTL≤60s. Counts/filter facets use authorised set only.

Visible change evidence: happy/loading/empty/error-denied/narrow/focus screenshots; commit/viewport/device/locale/theme/font/mode. A11y labels/states/dialog focus return, screen reader status, contrast4.5:1text/3:1nontext targets, no color-only state. Keyboard alternative to drag and hover. Synthetic fixtures labelled fixture; screenshots redact private actual data.

Cloud Linux Playwright proves renderer fixture behavior; test tenant proves provider read-back; macOS proves Electron/IPC/font/device/media permission. One receipt stores lanes separately; none substitutes for another.

## Installed UI cross-check

[Limited native observation](native-ui-observation.md) confirms existing navigation and Tasks layout only. Installed app uses selected dark/purple theme; target fixtures include light default and dark regression. Binary SHA and computed fonts not verified. No new product screen/runtime passes inferred.
