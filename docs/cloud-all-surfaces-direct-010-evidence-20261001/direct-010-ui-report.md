# R15 — direct exact010 optimized build/browser receipt

All three production builds and actual optimized Chromium run used source `010fa8c040e3a84cd40cd8195473f52d8582f159` directly. No a4→010 execution-equivalence inference is needed for this run.

Isolated checkout: `/tmp/rox-r15-exact-ui-20261001/checkout`, detached exact source after depth3 clone of `cloud/all-surfaces-20260930` at `1937be14afd9bd68ce8ec3df5af9b82f0fe3abc1`. Root owns docs publication; this agent did not commit, push, modify the PR, or chase branch heads.

Frozen inputs: main `f63294ba4fffa7238b46b24e918925a313ad0b12`; September `bac082301aed341fe078cb5bd539c4ba074560eb`; Compound `3027028c6c8cb420efe3ea4b255ac725747de9e5`; Runtime1319 `bdd28272856be5fdead6c7a93ca1b45eb13b17ed`. Hosted all4PASS is previously supplied owner evidence, not a new hosted execution by this browser agent.

| Actual command on exact010 | Exit | Seconds |
|---|---:|---:|
| `--no-env-file install --frozen-lockfile` | 0 | 18.187 |
| `--no-env-file run server:build:subprocess` | 0 | 1.229 |
| `--no-env-file run webui:build` | 0 | 71.331 |
| `--no-env-file build packages/server/src/index.ts --target bun --outdir dist-server --external xlsx` | 0 | 0.744 |

Toolchain: Bun `1.3.14`, Node `v24.19.0`, Chromium `151.0.7922.173`, Playwright `1.49.1`. Fresh production HTML imports `apps/webui/dist/assets/main-C_p8tRWb.js` (SHA256 `42c107212df162cea09f9d1ef136fe5ab7bf108eb9b44ba47c495e715c202d96`); 386 reachable JS assets and their maps are bound to the fresh own dist. Old generated entry chunks: 0. Actual browser time: `2026-10-01T17:01:11.174Z`–`2026-10-01T17:11:53.520Z` (UTC).

Actual main browser: **99 PASS / 0 FAIL / 0 phase errors / 0 lifetime pageerrors**, 22 root routes, 22 settings routes, 7 scoped mode clicks, 64 screenshots. Real header/centered pill/rail, user collapse+expand, persisted preference/reload, genuine Pages UI creation and persisted JSON/reload/same-profile restart, HTTP-default/WS-ACK agreement, missing workspace and URL mismatch refusals, stopped HTTP/WS and a fresh restart ACK executed. All page-log WebSockets are counted once; the restart ACK is separately bound to the new socket.

Actual supplemental auth: **11 PASS / 0 FAIL / 0 phase errors / 0 pageerrors**. Unauthenticated config API returned401; actual browser redirected to login without shell. Real bad-token form returned401 with Invalid credentials, no session cookie and no WebSocket. Correct form login set an HttpOnly cookie and received one actual HTTP-default workspace ACK. First supplemental run remains preserved as true exit1 with8 passing checks and a15s DOMContentLoaded wait timeout after genuine navigation to `/`; rerun changed only the observer wait to45s, and passed. This is observer timing evidence, not an accepted bootstrap-timeout application test.

Every one of 6178 tracked files was SHA256-hashed before/after install, before/after builds and after browser; all bytes match. Full built artifact manifest before/after browser also matches. Original checkout revision/status unchanged; application source, lockfiles, env/settings/secrets/network/permissions and Mac owner branches untouched. Full raw safe build/browser/server/provisioner logs, exact executed observers, source manifests, maps/source closure, retained compiled bytes and screenshots are present beside this report. No log filtering by `/tmp` parent path was applied.

All owned browser contexts, servers, short browser temp directories and private profiles are closed/removed; remaining owned child processes and profiles0. Exact010 checkout/dependencies stay available until root releases them for docs publishing and the parallel Electron verifier.

Native Notes and genuine Project fixtures render actual capability-unavailable UI; native preload, native principal/context, RepositorySnapshot/Roadmap functional native paths and contextual browser/terminal/cloud/extension/diff IDs were not invented. Unavailable Notes create remained disabled and attempted real mouse/Enter caused no hidden mutation. This bounded browser gate does not accept native Notes SAVE persistence, full109/143, installed native hosts, provider/OAuth, iOS, protected PG or security. The parent verifies Notes wire/nativeAction/pure PREPARE_CREATE/single writer/encrypted enqueue/trusted ACK/CAS/replay independently.

See [machine receipt](direct-010-ui-receipt.json), [main actual results](browser/results.json), [auth actual results](browser/auth-negative/results.json), [first timing RED](browser/auth-negative-first-red/results.json), [artifact manifest](artifacts-before-browser.json), [retained compiled/source manifest](retained-build-manifest.json). Model/effort runtime attestation tools are not exposed; none was fabricated.
