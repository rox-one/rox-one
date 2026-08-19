# 002 — WeChat iLink: keep with warning

Ticket 14.

**Status:** ACCEPTED — current shipping binding. This is not a new product flip; it records what already ships so the next agent does not delete the adapter.

**Owner:** product (pzd). An agent must not remove the transport.

## Context

Personal WeChat (微信) is wired through a vendored iLink ClawBot transport:

- Path: `packages/messaging-gateway/src/adapters/wechat/ilink/`
- Upstream: `@tencent-weixin/openclaw-weixin` **2.4.4**, MIT, Copyright (C) 2026 Tencent
- License text: `packages/messaging-gateway/src/adapters/wechat/ilink/LICENSE`
- Host adapter: `packages/messaging-gateway/src/adapters/wechat/index.ts`
- UI: Messaging settings + `WeChatConnectDialog`; RPC `startWeChatConnect` / verify / cancel
- Settings label: `settings.messaging.wechat.apiType` = “Official ClawBot channel”

The ticket asked: **keep with warning** / **remove**.

## Decision

**Keep with warning.** Do not delete the vendored tree or the settings/RPC wiring.

Warning the next reader should not miss:

- This is a **vendored snapshot** of Tencent’s iLink ClawBot transport, decoupled from the OpenClaw host. It is not WeChat Work / official enterprise API.
- iLink has a hard per-turn reply deadline; the adapter holds the turn open with heartbeat typing.
- Upstream is pinned at 2.4.4. Bumping means re-diffing the vendored tree, not `npm install`.
- Product/legal can still choose **remove** later; that is a human decision, not an agent cleanup.

## Considered options (not chosen)

- **Remove** — would drop a shipped channel that is already in settings + RPC. No human asked to remove it.

## Consequences

The adapter stays. Ticket 14 does not add new UI copy; the existing “Official ClawBot channel” label is the in-product warning. A later human may want a stronger disclaimer — that is out of scope here.
