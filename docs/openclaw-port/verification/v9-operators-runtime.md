# V9 — operator roles at live WS admission (runtime, sliced a1.2)

Rows: **a1.2** (named operator roles + method-scope ceiling, fail-closed, LOCAL_ONLY unreachable,
durable tombstone, no client-supplied role).
Verifier: `w2-verify-1`. Date: 2026-10-09. Tree: `main` @ `cfb1f1b8d` (deps installed).

Targets under test:
`packages/server-core/src/authority/operator-role-policy.ts`,
`packages/server-core/src/authority/native-authority.ts`,
`packages/server-core/src/transport/server.ts`.
Harness guide: **`packages/server-core/src/transport/__tests__/operator-role-admission.test.ts`**
(note: the item pointed at `packages/server-core/src/authority/__tests__/`; the admission test
actually lives under `transport/__tests__/`. `authority/__tests__/` holds
`operator-role-policy.test.ts` — pure policy, no WS).

## Surface driven (real processes / real WS RPC / real files)

- **Server**: a real `WsRpcServer` (`packages/server-core/src/transport/server.ts`) constructed with
  `{ port: 0, requireAuth: true, nativeAuthority }` → bound to a **random loopback port**
  (`ws://127.0.0.1:57669` this run). Real handlers registered with real `nativeAction` classifications.
- **Authority**: a real `NativeAuthority` (`native-authority.ts`) on an isolated `mkdtemp` state dir
  (private SQLite `authority.sqlite`); real `bootstrapLocalAdministrator` + `issueEnrollment`/
  `redeemEnrollment` + `grantWorkspace` + `defineOperatorRole`/`assignOperatorRole`.
- **Clients**: the real `ws` WebSocket client (`ws@8.22.0`) doing the real native credential
  handshake (`na_…` token, `protocolVersion`), one socket per principal. `resolveLocalClientBinding`
  is **not** wired, so every client is a genuine *remote* (unbound) caller.
- **Frames**: every inbound frame was captured verbatim before decode; raw strings are quoted below.
- Harness (scratch, not committed): `/tmp/w9-operators/harness.ts`; full JSON transcript
  `/tmp/w9-operators/transcript.json`.

```
$ cd /Users/t/Projects/rox-one-port
$ timeout 180 bun /tmp/w9-operators/harness.ts > /tmp/w9-operators/transcript.json   # exit 0
```

Fixture A gives two live sockets with **different ceilings**: member `first` → role `owner`
(shares `OPERATOR_SCOPES`), member `second` → role `viewer`
(`{ scopes: ['operator.read','operator.sessions.read'] }`). Both keep identical workspace grants
(`read`,`write`,`subscribe`), so the only difference is the operator ceiling.

Real handshake acks (raw), showing the admitted channel set is ceiling-derived per connection:

```json
{"id":"handshake","type":"handshake_ack","protocolVersion":"1.0","clientId":"cbc0d9ff-…","registeredChannels":["native:read","native:write","sessions:create"],"workspaceId":"workspace-a"}
{"id":"handshake","type":"handshake_ack","protocolVersion":"1.0","clientId":"23e6133c-…","registeredChannels":["native:read"],"workspaceId":"workspace-a"}
```

The `viewer` socket is denied advertisement of `native:write` while the `owner` socket keeps it —
`registeredChannelsFor` filters through `operatorCeilingAllows`
(`server.ts:425-432`, `:500-508`).

---

## (1) method outside the ceiling → `OPERATOR_ACCESS_DENIED` — **PASS**

`viewer` (ceiling `operator.read`+`operator.sessions.read`) invokes `native:write`
(classified `operator.write`, `server.ts:1369-1372`):

```json
$ request viewer native:write
{"id":"1e0b5d3b-bca6-4df7-9e32-39ff40bedaa7","type":"response","channel":"native:write","error":{"code":"OPERATOR_ACCESS_DENIED","message":"Operator role cannot invoke this method"}}
```

Controls prove the gate is per-channel, not a blanket deny:

```json
$ request owner  native:write
{"id":"92180f39-8e46-4290-9d66-b9a6fa8787ad","type":"response","channel":"native:write","result":"committed"}
$ request viewer native:read
{"id":"348c9411-9e48-4aba-8102-a2fcd8513a68","type":"response","channel":"native:read","result":"changed"}
```

The denial happens **before** the handler runs; the workspace file after all case-1 calls is
`changed` (the owner's write), i.e. the denied write left no side effect:
`cleanup.note_md_after_case1 = "changed"`.

Enforcement: `isChannelWithinOperatorCeiling` (`operator-role-policy.ts:276-288`) via
`classifyOperatorChannel` (`:252-266`); typed error emitted at `server.ts:1369-1372`.
Verdict: **PASS**.

## (2) LOCAL_ONLY channels refused for remote callers — **PASS** (both sub-cases)

`system:versions` is a LOCAL_ONLY channel (`packages/shared/src/protocol/routing.ts:136`,
`channels.ts:358`). The server enforces the local-desktop gate on server-verified state only
(`localBinding === null` for every remote client here; `server.ts:1344-1363`).

### (2a) even with a PERMISSIVE ceiling (owner holds *every* scope)

```json
$ request owner system:versions
{"id":"f9d41a12-c27d-422d-8ea6-b541bb63a300","type":"response","channel":"system:versions","error":{"code":"LOCAL_ONLY_DENIED","message":"Channel is only available to the local desktop client"}}
```

and the channel is never advertised: `owner_registeredChannels_has_system_versions = false`.

### (2b) even when the operator boundary is ABSENT (no roles ever configured)

Fixture B defines/assigns nothing → `resolveOperatorCeiling` returns
`configured:false, scopes: ALL_OPERATOR_SCOPES` (`native-authority.ts:788-790`). The connected
member still keeps its grant-based authority (`native:read → "original"`) and is still refused:

```json
$ request member native:read
{"id":"dd0b971f-6dbf-4d25-a606-37db6afd45a1","type":"response","channel":"native:read","result":"original"}
$ request member system:versions
{"id":"445e8e92-3541-4f95-a05d-5fcb0adea7e9","type":"response","channel":"system:versions","error":{"code":"LOCAL_ONLY_DENIED","message":"Channel is only available to the local desktop client"}}
```

`registeredChannels = ["native:read","native:write","sessions:create"]` — the absent boundary does
**not** reopen the LOCAL_ONLY refusal.

Enforcement (fail-closed): `classifyOperatorChannel` returns `remote:false` for any
`isLocalOnly(channel)` regardless of `nativeAction` (`operator-role-policy.ts:257`), and
`isChannelWithinOperatorCeiling` refuses non-remote channels before consulting the ceiling
(`:283`). Verdict: **PASS**.

## (3) removing the LAST role (durable tombstone) revokes the ALREADY-CONNECTED client — **PASS**

Fixture C: exactly one role `temp` (`{ scopes:['operator.read'] }`), assigned to member `second`.
The socket is connected and works, then the **only** role definition is removed on the live
authority — no reconnect, no new handshake:

```json
$ request connected native:read        # before removal
{"id":"256125bb-d33d-40b6-bad9-7867e1848554","type":"response","channel":"native:read","result":"original"}

$ authority.removeOperatorRole(admin, "temp")   # <- no socket was touched

$ request connected native:read        # the SAME socket, next request
{"id":"556bb820-8218-4c08-a582-f2b0031ecb53","type":"response","channel":"native:read","error":{"code":"OPERATOR_ACCESS_DENIED","message":"Operator role cannot invoke this method"}}
$ request connected native:write
{"id":"12b7aa97-88ce-4737-9ecf-44fc1e62492a","type":"response","channel":"native:write","error":{"code":"OPERATOR_ACCESS_DENIED","message":"Operator role cannot invoke this method"}}
```

The live client's stored ceiling was re-resolved synchronously by the authority invalidation
listener (`server.ts:365-378` → `revalidateOperatorCeiling`, `:483-493`), so its very next request
fails closed.

**Durability** — after the last definition is gone, the boundary must NOT silently reopen. The
authority DB was closed and reopened in a fresh `NativeAuthority` on the same `stateDir`; the
persisted tombstone keeps the boundary configured as deny-all:

```json
{ "reopened_ceiling": { "configured": true, "role": null, "scopes": [] } }
```

(tombstone written at `native-authority.ts:692-693`; read at `#operatorRolesConfigured`, `:806-810`;
`resolveOperatorCeiling` maps a configured-but-unresolvable principal to `DENIED_OPERATOR_CEILING`,
`:791-797`). Verdict: **PASS**.

## (4) a client cannot claim a role it was not assigned — **PASS**

Handshake fields are attacker-controlled; native admission uses only the credential →
`NativePrincipal` → server-side `resolveOperatorCeiling`. Two sockets were opened whose handshake
envelopes **spoof** an owner ceiling —
`operatorRole:"owner"`, `role:"owner"`, `scopes:[…all…]`,
`clientCapabilities:["operator.admin","operator.write"]`,
`roleCeiling:{configured:true,role:"owner",scopes:[…all…]}`:

- `viewer` (assigned `viewer`) with the spoof:

```json
registeredChannels = ["native:read"]          // spoofed native:write NOT admitted
$ request viewerSpoof native:write
{"id":"f4807173-bf7a-4495-852f-6fb40a53cae4","type":"response","channel":"native:write","error":{"code":"OPERATOR_ACCESS_DENIED","message":"Operator role cannot invoke this method"}}
```

- `third` (assigned **no** role; roles are configured) with the same spoof:

```json
registeredChannels = []                        // nothing admitted
$ request thirdSpoof native:read
{"id":"3da7d71b-d0a1-454a-ada5-1033322f0978","type":"response","channel":"native:read","error":{"code":"OPERATOR_ACCESS_DENIED","message":"Operator role cannot invoke this method"}}
```

The persisted assignment (None) governs: an unassigned member under a configured boundary gets
deny-all (`native-authority.ts:791-797`), and no handshake field can widen it. The ceiling is
resolved once at admission from `nativeAuthority.resolveOperatorCeiling` (`server.ts:1209-1212`)
and re-derived on role change (`:365-378`) — never from the envelope.
Verdict: **PASS**.

---

## Summary

| Claim | Verdict |
|---|---|
| (1) method outside ceiling → `OPERATOR_ACCESS_DENIED`, no handler side effect | **PASS** |
| (2a) LOCAL_ONLY refused with permissive ceiling | **PASS** |
| (2b) LOCAL_ONLY refused with absent boundary | **PASS** |
| (3) removing the last role revokes the already-connected client on its next request | **PASS** |
| (3+) tombstone durable across authority reopen (configured deny-all) | **PASS** |
| (4) client-supplied role ignored (no escalation) | **PASS** |

No FAILs observed. All verdicts are from raw WS frames produced by real server/client sockets on a
random port; no unit-test result was used as evidence.

### Scope notes

- Two live clients with different ceilings were driven (owner vs viewer) plus a spoofing pair.
- The authority is in-process with the server (as the repo's own admission harness constructs it);
  the DB is a real on-disk private SQLite store, and the tombstone durability check reopens it.
- `ws` token clients connect over loopback with `requireAuth:true`, so `shouldEnforceLocalOnly()`
  is true (`server.ts:1290-1294`) and `localBinding === null` — a faithful remote caller.