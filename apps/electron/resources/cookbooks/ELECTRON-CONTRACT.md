# ROX Cookbooks Lab — Electron integration contract (host side)

How the ROX desktop (Electron main) talks to the Cookbooks Lab sidecar. This document covers the
**host side only**: the loopback HTTP surface in this repo. The Electron main process, the ROX
sidebar UI and the reading of ROX's `credentials.enc`/keychain are **out of this repo** — see
`docs/spec.md:29`, `plans/README.md:51-52`.

Two kinds of statement appear here:

- **Current behavior** — implemented in this tree; every claim cites a file path (and line where
  useful). Code wins over this document.
- **Proposal** — a decision the Electron side still has to make, or a change this repo has not
  made. Labelled `Proposal`; not implemented today.

Evidence: `scripts/electron_handshake_probe.py` spawns the sidecar exactly as described in §2/§3
and asserts the handshake below. Its expected output is in §8.

## 1. Topology

```
[ROX Electron main]                     (owns the app, the sidebar, credentials.enc)
   │  spawn + read startup line
   ▼
[Lab sidecar: python scripts/serve_lab.py]      loopback HTTP, 127.0.0.1:<ephemeral>
   │  LabHost — JSON API + /lab.html             src/rox_cookbooks/host.py:60
   │  workspace: <workspace>/cookbooks/<copyId>/
   ▼
[per-copy venv kernels]  .venv/bin/python -c <runner>   one process per Run
```

- **Sidecar host.** `LabHost` (`src/rox_cookbooks/host.py:60`) binds **loopback only**, on an
  **OS-assigned port**: `ThreadingHTTPServer(("127.0.0.1", 0), Handler)`
  (`src/rox_cookbooks/host.py:360`). `scripts/serve_lab.py:21-26` is the process entry point; it
  constructs the host, starts it and prints the URL (see §2).
- **Threaded.** `ThreadingHTTPServer` serves each request on its own thread
  (`src/rox_cookbooks/host.py:360`), so a slow `POST /run` does not block `/catalog` or the page.
- **Workspace.** Personal copies live under `<workspace>/cookbooks/<copyId>/`
  (`src/rox_cookbooks/copies.py:56-60`), created/resumed by `CookbookCopies.open`
  (`src/rox_cookbooks/copies.py:62-94`). Default workspace is `./.rox-cookbooks-workspace`
  (`scripts/serve_lab.py:18`) — an Electron launch **must** pass `--workspace` an app-owned path.
- **Per-copy venv.** `.venv` is a property of the copy (`src/rox_cookbooks/copies.py:229`), created
  on the **first Run**, not on open (`ensure_venv`, `src/rox_cookbooks/kernel.py:822`;
  `install_requirements`, `:504`; spec requirement 6 in `docs/spec.md:19`).
- **One kernel per copy.** `Kernel` is bound to one copy (`src/rox_cookbooks/kernel.py:872-879`);
  `KernelManager` keeps at most one per copy root (`:1012-1041`). Two copies run concurrently in
  their own venvs (A8, `docs/spec.md:139`).
- **v1 transport is one-shot.** Each Run spawns a fresh `python -c <runner>` in the copy venv
  (`_RUNNER`, `src/rox_cookbooks/kernel.py:856-869`; `Kernel.execute`, `:934-1002`). **No state
  carries between cells** (`docs/spec.md:48`, `:103`). A long-lived ipykernel over ZMQ on
  127.0.0.1 + token is **planned, not built** (`docs/spec.md:64-71`, `docs/plan.md:20`).
- **Renderer never sees raw secret values.** `docs/spec.md:69`; the host redacts the cell streams
  (`src/rox_cookbooks/kernel.py:979-989`) and returns key names only (§5).
- **Isolation is "local Python", not a sandbox.** Kernel cwd is the copy directory
  (`src/rox_cookbooks/kernel.py:955`) and the child sees an allowlisted environment plus the copy's
  declared secrets (`_CHILD_ENV_ALLOWLIST`, `src/rox_cookbooks/kernel.py:75-90`, `:1004-1009`).
  Do not claim stronger isolation than a local Jupyter process (`docs/spec.md:72`).
- **Canonical catalog is read-only.** Bundled resources at `resources/cookbooks/`
  (`src/rox_cookbooks/catalog.py:99-100`); the copies layer refuses to write into it
  (`src/rox_cookbooks/copies.py:204-206`).

## 2. Process lifecycle

### 2.1 Spawn

```
python scripts/serve_lab.py [--workspace DIR] [--store FILE]
```

- Args: `--workspace` (default `./.rox-cookbooks-workspace`, `scripts/serve_lab.py:18`), `--store`
  (default none, `:19`). No environment variables are required (`README.md:16`).
- `serve_lab.py` puts `src/` on `sys.path` itself (`scripts/serve_lab.py:10-11`), so the sidecar can
  be spawned without `PYTHONPATH`.
- **Proposal.** Launch with an explicit interpreter path (the app-bundled Python) rather than
  `python3` from `PATH`, and pass absolute `--workspace`/`--store` paths; the sidecar inherits the
  spawning process's environment, and `serve_lab.py` reads no config of its own.

### 2.2 Ephemeral port discovery

- The host binds port `0` (`src/rox_cookbooks/host.py:360`); `LabHost.url` reads the assigned port
  back from `httpd.server_address` (`src/rox_cookbooks/host.py:79-84`).
- The sidecar prints **one line** to stdout at startup (`scripts/serve_lab.py:26`):

  ```
  http://127.0.0.1:<port>/lab.html?token=<token>
  ```

  That line **is** the discovery protocol: read it, parse the port and the token, then load it.
  `README.md:52-53` states the same ("The port is random… use that URL rather than assuming a
  port").
- The sidecar prints the line and then sleeps forever (`scripts/serve_lab.py:27-29`). It writes no
  PID file, port file or lock file.
- **Proposal.** Have the sidecar also write a small discovery file (`{port, token, pid, startedAt}`)
  next to the workspace, so a supervising Electron process that missed stdout — or restarted —
  can re-attach. Today, a missed line is unrecoverable and requires a restart.
- **Proposal.** Writes to stdout are block-buffered when stdout is a pipe. Spawn with `python -u`
  or `PYTHONUNBUFFERED=1` (the probe does; `scripts/electron_handshake_probe.py`) or the URL line
  may not arrive until the process exits.

### 2.3 Health check

There is **no** health route today. The routes that answer without side effects:

| Probe | Expects | Cite |
|---|---|---|
| `GET /lab.html` | 200, HTML (no token needed) | `src/rox_cookbooks/host.py:172-174` |
| `GET /catalog` with token | 200, JSON array (13 cards) | `src/rox_cookbooks/host.py:178-179` |

Use `/lab.html` for liveness (it is the cheapest unauthenticated route) and `/catalog` for
readiness (it proves the catalog loaded and the token works). Anything else on a bad Host header
answers 403 (`src/rox_cookbooks/host.py:168-169`, `:209-210`).

- **Proposal.** Add `GET /healthz` (loopback-only, no token, fixed tiny JSON: `{"ok":true,
  "version":…, "startedAt":…}`) so the supervisor does not have to parse HTML, and so the
  _readiness_ check can be separated from the catalog read.

### 2.4 Graceful shutdown

- **SIGINT** is the shutdown signal. `serve_lab.py` runs the sleep loop inside
  `try/except KeyboardInterrupt` and calls `lab.stop()` (`scripts/serve_lab.py:27-32`);
  `LabHost.stop` shuts the HTTP server down, closes the socket, and joins the serve thread with a
  2 s timeout (`src/rox_cookbooks/host.py:519-528`). The process then exits **0**.
- **SIGTERM is not handled.** `serve_lab.py` catches `KeyboardInterrupt` only, so `SIGTERM`/`SIGKILL`
  terminate the process without calling `stop()`. Nothing is lost in v1: kernels are one-shot child
  processes (`src/rox_cookbooks/kernel.py:948-958`) and the serve thread is a daemon
  (`src/rox_cookbooks/host.py:361`), so the process still exits; the socket is released by the OS.
- There is no shutdown route (`POST /shutdown` does not exist; `do_POST` returns 404 for it,
  `src/rox_cookbooks/host.py:357`).
- **Proposal.** Install a `SIGTERM` handler in `serve_lab.py` that calls `lab.stop()` first, so the
  supervisor can use the conventional signal, and/or add `POST /shutdown` (token-gated) for a
  request-level stop.
- **In-flight runs are killed on shutdown.** `LabHost.stop` cancels every active execution before
  tearing the server down (`src/rox_cookbooks/host.py:519-528`), killing each cell's process group
  through the shared `ActiveRuns` registry (`src/rox_cookbooks/kernel.py:1010-1050`). Cell
  processes start their own session (`start_new_session=True`), so without this they would survive
  the sidecar; after a normal stop no cell process is left behind. The host still builds a throwaway
  `Kernel` per Run (`execute_code`, `src/rox_cookbooks/kernel.py:1293`) rather than holding a
  `KernelManager`.

### 2.5 Crash and restart

- There is **no supervisor** in this repo: if the sidecar dies, nothing restarts it, and the port
  and token change on the next start (`secrets.token_urlsafe(24)`,
  `src/rox_cookbooks/host.py:71`).
- A **cell** crash is contained: `Kernel.execute` never raises for cell failure, timeout or
  interrupt (`src/rox_cookbooks/kernel.py:934-1002`); the child is killed as a process tree on
  timeout/interrupt (`_kill_process_tree`, `:1126-1142`).
- The **host** does not crash on bad input: every handler error path is mapped to 4xx JSON, never a
  dropped connection (`plans/011-host-input-safety.md:95-98`, `plans/README.md:8-10`).
- **Proposal.** Electron main owns restart: on sidecar exit, respawn with the same `--workspace`,
  re-read the startup line, and reload the sidebar URL. Do not reuse the old token or port — both
  are new per process (`src/rox_cookbooks/host.py:71`, `:360`).
- **Proposal.** Restart budget/backoff, and a user-visible state when the sidecar cannot start
  (e.g. no readable `--store`, no Python >= 3.11 — §6).

### 2.6 Logs

- **The HTTP server logs nothing.** `Handler.log_message` is a no-op
  (`src/rox_cookbooks/host.py:90-91`), so there is no access log on stdout/stderr.
- The only startup output is the URL line (`scripts/serve_lab.py:26`).
- Provisioning logs are **data, not files, by default**: `install_requirements` returns
  `ProvisionResult.log` (`src/rox_cookbooks/kernel.py:461-493`) and only writes a file when a caller
  passes `log_path` (`_write_log`, `:687-692`) — **no caller in this repo does**
  (`execute_code` → `Kernel.execute` → `ensure_python`/`ensure_venv` pass none:
  `src/rox_cookbooks/kernel.py:1115`, `:907-909`, `:822-853`).
- `POST /run` **does not** return the install log: the response is filtered to
  `ok, stdout, stderr, returncode, error, timed_out` plus `missing`
  (`src/rox_cookbooks/host.py:289-295`). A pip failure therefore surfaces to Electron as an
  `error` string containing the log text, not as a structured log field
  (`InstallError` → `KernelError` with log appended, `src/rox_cookbooks/kernel.py:606-612`).
- **Proposal.** Expose the install log (`ProvisionResult.as_dict()` already has the shape,
  `src/rox_cookbooks/kernel.py:478-493`) on `/run`, or add a `log_path` under the workspace and
  return its path, so the sidebar can render a progress/install panel (`docs/spec.md:113`).
- **Proposal.** Decide where Electron redirects the sidecar's stdout/stderr; today the URL line is
  the only thing on stdout and nothing is on stderr except an unhandled traceback (§6).

## 3. Handshake & auth

### 3.1 Token source

- The token is generated by the host: `self.token = token or secrets.token_urlsafe(24)`
  (`src/rox_cookbooks/host.py:71`) — 24 random bytes, URL-safe base64. `LabHost` accepts an
  injected `token=` for tests (`src/rox_cookbooks/host.py:65`; `tests/test_host.py:19`).
- The token lives for the life of the process. It is a bearer credential for a loopback-only
  server, so it is not rotated or expired in v1 (`plans/README.md:53`).

### 3.2 Passing the token

`_ok_auth` accepts exactly two transports (`src/rox_cookbooks/host.py:93-98`):

```python
q = parse_qs(urlparse(self.path).query)
if q.get("token", [None])[0] == lab.token:            # ?token=<token>
    return True
auth = self.headers.get("Authorization", "")
return auth == f"Bearer {lab.token}"                  # Authorization: Bearer <token>
```

- **Query** (`?token=`) is what the HTML page uses: the sidecar prints it in the startup URL
  (`scripts/serve_lab.py:26`) and the page reads it from `location.search`
  (`src/rox_cookbooks/static/lab.html:47`).
- **Header** (`Authorization: Bearer <token>`) is what the page uses for every API call
  (`src/rox_cookbooks/static/lab.html:48`, `:110-127`). This is the transport Electron should use
  for its own calls.
- Query tokens can leak through `Referer`/history; the host mitigates with
  `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY` on every response (`_security_headers`, `src/rox_cookbooks/host.py:117-123`),
  and the page never writes the token into the DOM (`src/rox_cookbooks/static/lab.html:46`).
- Comparison is a plain `==`, not constant-time — a deliberate decision for a loopback,
  single-user tool (`plans/README.md:53`).

### 3.3 The gate is on the JSON surface, not the page

**Current behavior — read this carefully; it is the most commonly mis-stated part of the contract:**

- `GET /` and `GET /lab.html` are served **without a token**. Only the Host header is checked
  (`src/rox_cookbooks/host.py:167-174`). The module docstring says so:
  "GET / and /lab.html are the local notebook surface (token in query)" (`src/rox_cookbooks/host.py:1-6`).
- **Every JSON route** — `/catalog`, `/search`, `/banner/*`, `/document/*`, and all POSTs — calls
  `_ok_auth` and answers **401** without a valid token (`src/rox_cookbooks/host.py:175-176`,
  `:211-212`).
- A **DNS-rebinding guard** runs first on every request: the `Host` header, port stripped and
  lowercased, must be in `{127.0.0.1, localhost, ::1, [::1]}` (`ALLOWED_HOSTS`,
  `src/rox_cookbooks/host.py:34`; `_host_allowed`, `:100-115`), else **403**
  (`:168-169`, `:209-210`). An absent Host header is refused.
- The page itself carries no data, which is why serving it unauthenticated is acceptable
  (`plans/README.md:54`). The data behind it is always gated.

The probe asserts exactly this (`scripts/electron_handshake_probe.py`, §8):

| Check | Expected |
|---|---|
| `GET /lab.html` (no token) | 200 |
| `GET /lab.html?token=<t>` | 200 |
| `GET /catalog` (no token) | 401 |
| `GET /catalog` (wrong token) | 401 |
| `GET /catalog` `Authorization: Bearer <t>` | 200, JSON array |
| `GET /catalog?token=<t>` | 200, JSON array |
| unknown route with token | 404 |

- **Proposal.** If the sidebar is ever exposed beyond loopback, the page must become token-gated
  too; that is a one-line reorder in `do_GET` (move the `_ok_auth` check above the
  `/`-and-`/lab.html` branch, `src/rox_cookbooks/host.py:172-176`). Do not make that change
  without also giving Electron a header-based way to load the page, since a top-level navigation
  cannot set `Authorization`.

### 3.4 Status codes

| Status | When | Cite |
|---|---|---|
| 200 | success; also `/` and `/lab.html` unauthenticated | `src/rox_cookbooks/host.py:172-174`, `:150-157` |
| 400 | bad itemId/index/flag, unknown item, no kernel for item, corrupt notebook, `CatalogError`/`CopyError`/`NotebookError`/`KernelError` | `:220-357` |
| 401 | missing/incorrect token on a JSON route | `:175-176`, `:211-212` |
| 403 | Host header is not loopback | `:168-169`, `:209-210` |
| 404 | unknown path; `POST /cancel` for an unknown `itemId` | `:206`, `:357` |
| 413 | POST body over 2 MiB | `:30`, `:131-132` |
| 503 | `/run` or `/run-all` arrives after `LabHost.stop` began (`{"error":"host is shutting down"}`) | `src/rox_cookbooks/host.py:92-102`, `:276-277` |

All error bodies are `{"error": "<message>"}`, so a client can always show `data.error`
(`src/rox_cookbooks/host.py:150-157`). `/document/<id>` adds `"reset": true` when the copy's
notebook is corrupt, meaning "offer Reset" (`:201-202`). The only 5xx is `503` for a `/run` or
`/run-all` that arrives after shutdown began (below); the host maps even kernel-start failures to
400 (`plans/011-host-input-safety.md:109-112`).

### 3.5 API surface

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/` , `/lab.html` | — (no token) | HTML page (`src/rox_cookbooks/host.py:26`, `:172-174`) |
| GET | `/catalog` | — | card array (`catalog_cards`, `src/rox_cookbooks/ui.py:65-87`) |
| GET | `/search` | `?q=` | card array subset (`src/rox_cookbooks/host.py:180-188`) |
| GET | `/banner/<itemId>` | — | `{"missing": [key, …]}` (`:189-196`) |
| GET | `/document/<itemId>` | — | ipynb `{kind,title,cells[{cell_type,source,outputs}],missing,supported}` / md `{kind,title,text,missing,supported:false}` (`:365-393`) |
| POST | `/open` | `{itemId, newCopy?}` | `{copyId, document}` (`:220-230`) |
| POST | `/run` | `{itemId, code, index?, store?}` | `{ok,stdout,stderr,returncode,error?,timed_out?,cancelled,missing}` (`src/rox_cookbooks/host.py:238-309`) |
| POST | `/run-all` | `{itemId, cells:[{index,source}], store?}` | `{ok,timed_out,returncode,cancelled,missing,cells:[…]}` (`src/rox_cookbooks/host.py:310-406`) |
| POST | `/cancel` | `{itemId}` | `{ok:true, cancelled:<int>}` (`src/rox_cookbooks/host.py:407-419`) |
| POST | `/reset` | `{itemId, confirm?}` | `{ok:true}` (`:296-307`) |
| POST | `/save` | `{itemId,index,source}` or `{itemId,text}` | `{ok:true}` (`:308-346`) |
| POST | `/store` | `{store:{key:value}}` | `{keys:[…]}` (`:347-356`) |

Card and `missing` payloads carry **credential key names only** (`src/rox_cookbooks/ui.py:65-87`;
`src/rox_cookbooks/secrets.py:25-36`) — never values.

### 3.6 Cancel (`POST /cancel`)

- `POST /cancel {itemId}` interrupts **every** in-flight execution for that item — both `/run`
  and `/run-all` — and answers `200 {"ok": true, "cancelled": <int>}`, where the count is how many
  runs were still live (`src/rox_cookbooks/host.py:407-419`). It is **idempotent**: with nothing
  running it answers `cancelled: 0`. An `itemId` that does not resolve in the catalog is `404`
  (like an unknown path); a missing `itemId` is `400`.
- The host keeps a **thread-safe registry** of in-flight executions keyed by `itemId`
  (`ActiveRuns`, `src/rox_cookbooks/kernel.py:1033-1080`). Each `/run`/`/run-all` registers its
  handle **before** resolving the item or spawning, and releases it when the request returns
  (`LabHost.begin_run`, `src/rox_cookbooks/host.py:92-102`, used at `:276` and `:384`). Cancelling
  kills the child's **process group** (`_kill_process_tree`, SIGKILL), the same path a cell timeout
  uses.
- **Shutdown gate.** `begin_run` refuses (`503`) once `LabHost.stop` has begun: it takes the same
  lifecycle lock that `stop` holds while it sets the flag and cancels, so a run can never start
  after the stop-time sweep (`src/rox_cookbooks/host.py:565-573`).
- `/run` and `/run-all` responses gain an **additive** `"cancelled": true|false` field: `true` when
  this request's run was stopped by `/cancel`, `false` otherwise (`src/rox_cookbooks/host.py:341`,
  `:433`). No existing field changes.
- For `/run-all`, the per-cell records already written to the temp `results.json` are kept, so a
  partially completed run reports the finished cells; the remaining cells come back `skipped`
  (`execute_all`, `src/rox_cookbooks/kernel.py:1328-1502`).

## 4. Sidebar embedding

### 4.1 The URL to load

```
http://127.0.0.1:<port>/lab.html?token=<token>
```

exactly the line `serve_lab.py` prints (`scripts/serve_lab.py:26`; `README.md:18`, `:52-53`).
`GET /` serves the same document (`src/rox_cookbooks/host.py:172`).

- The page is **one self-contained HTML file** — inline `<style>` and `<script>`, no external
  assets (`src/rox_cookbooks/static/lab.html:1-45`), served from disk on every request
  (`src/rox_cookbooks/host.py:26`, `:173`), which is why there is no CSP: a CSP would break the
  inline script (`src/rox_cookbooks/host.py:118-119`).
- The page is the **v1 notebook surface** (`docs/plan.md:64-67`); the native ROX notebook renderer
  (Notebook 7 / `@jupyterlab/notebook` in a BrowserView) is **planned, not in this repo**
  (`docs/spec.md:71`).

### 4.2 Framing

- Every response carries `X-Frame-Options: DENY` (`src/rox_cookbooks/host.py:121`). A browser
  `<iframe>`/WebView-nested load of `/lab.html` **will be blocked**.
- An Electron `BrowserView`/`WebContentsView` that loads the URL as a **top-level** navigation is
  not affected (XFO governs framing).
- **Proposal.** Pick the container explicitly: top-level `BrowserView`/`WebContentsView` (works
  today), or relax `X-Frame-Options` to an allowlist for the ROX shell origin (a host-side change,
  not this repo's), or serve a token-gated page in an iframe with its own CSP.
- **Proposal.** When embedding in a frame, note the page's inline script means a strict CSP needs a
  nonce/hash; today there is none (`src/rox_cookbooks/host.py:118-119`).

### 4.3 Focus and visibility

- The host has **no push channel** — no WebSocket, no SSE, no long-poll. Every refresh is a fresh
  HTTP call (`src/rox_cookbooks/static/lab.html:110-127`).
- The page fetches on load only: `runSearch()` runs once at script end
  (`src/rox_cookbooks/static/lab.html:274`), and search re-fetches on input with a 200 ms debounce
  (`:266-273`). Nothing re-reads on `focus`/`visibilitychange`.
- **Proposal.** The sidebar should re-issue `GET /catalog` (and re-read the open document) when the
  view becomes visible, since another window/copy can change the workspace underneath it. Either
  drive that from the Electron side (reload/`webContents.executeJavaScript('refreshList()')`) or
  add a `visibilitychange` listener to the page.
- **Proposal.** If the Lab is ever shown in more than one window, do the focus/refresh in Electron
  rather than adding server-side push; the token/session model is per-process (§2.5).

### 4.4 External links

- The page renders **no links and no link clicks**: output is written with `textContent`
  (`src/rox_cookbooks/static/lab.html:195`) via `outputText`, which only joins
  `output.text`/`output.traceback` as text (`:161-170`). All navigation is `fetch` to the same
  origin (`:110-127`).
- The page also never writes markup: nodes are built with `createElement`/`textContent`
  (`el()`, `src/rox_cookbooks/static/lab.html:53-66`) — there is no `innerHTML` path.
- **Proposal.** Still set Electron navigation policy up front: deny `will-navigate` off
  `http://127.0.0.1:<port>`, and route any future outbound link through
  `setWindowOpenHandler` + `shell.openExternal`. Today a vendor notebook can print a URL into cell
  output, but the page will not make it clickable; if that changes, the policy must exist first.

### 4.5 Offline behavior

- The page itself loads from loopback and needs no network (`src/rox_cookbooks/host.py:172-174`) —
  catalog, search, open, save and Reset are all local filesystem work
  (`src/rox_cookbooks/copies.py`, `src/rox_cookbooks/notebooks.py`).
- Markdown playbooks work fully offline: they open as an editable `<textarea>` with a Save button,
  no kernel (`src/rox_cookbooks/static/lab.html:180-190`; spec requirement 7, `docs/spec.md:20`).
- Run needs the network only for its own API calls and for the **first** `pip install`
  (`docs/spec.md:31`). A Run with no network fails as a normal cell failure — see §6.
- **Proposal.** Show an offline/degraded state in the sidebar chrome rather than relying on cell
  errors alone; the host has no network concept today.

## 5. Secrets flow

### 5.1 Where values come from (and where they do not)

- The Lab **never opens `credentials.enc` or the OS keychain**. That is Electron main's job
  (`docs/spec.md:29`; `plans/README.md:51-52`). Nothing in `src/` reads or writes that file.
- The Lab consumes a **credential-status store**: a JSON object mapping ROX credential keys to
  values (`{"openai.api_key": "sk-…"}`, `README.md:30-35`). It arrives one of two ways:
  1. `--store FILE` → `LabHost(store_path=…)` (`scripts/serve_lab.py:19`, `:23`) → `load_store`
     (`src/rox_cookbooks/ui.py:125-147`). A **missing/unreadable file is an empty store**, not an
     error (`src/rox_cookbooks/ui.py:137-140`; `README.md:34`); malformed JSON raises
     `ValueError` at startup (`:141-144`).
  2. `POST /store {"store": {…}}` (`src/rox_cookbooks/host.py:347-356`) — **replaces** the
     in-memory store and answers with **key names only** (`{"keys": […]}`). Empty object, non-object
     or non-string values → 400 (`:349-354`).
  - `POST /run` may also carry a one-shot `store` object, merged over the host store for that run
    only (`src/rox_cookbooks/host.py:238-240`, `:273-276`).
- Key → env mapping is the catalog's `secretMap` (`resources/cookbooks/catalog.json:4-11`). Only the
  item's declared `requiredSecrets` are resolved (`env_for_item`, `src/rox_cookbooks/secrets.py:10-22`;
  `missing_secrets`, `:25-36`).
- **Environment fallback.** If no store is passed (`store is None`), the Lab probes the **process
  environment** instead (`src/rox_cookbooks/secrets.py:15`, `:30`; `README.md:26`). The host always
  passes a dict (`src/rox_cookbooks/host.py:273`, `:368`), so a host-side Run never reads ambient
  env — but a CLI run without `--store` does. **Proposal.** Decide the store precedence explicitly
  and pass an empty dict (not `None`) from Electron-facing code paths; see §7.11.

### 5.2 Never written to disk

**Verified:** the Lab never writes secret material to disk, and never writes the store file.

- `POST /store` only rebinds `lab.store` in memory (`src/rox_cookbooks/host.py:355`).
- The store file is **caller-supplied and only read** (`src/rox_cookbooks/ui.py:136-147`); nothing
  in `src/` writes it. Grepping `src/` for file writes finds only: copy document, `requirements.txt`
  and `origin.json` (`src/rox_cookbooks/copies.py:76`, `:78`, `:132`, `:142`), the notebook/playbook
  document (`src/rox_cookbooks/notebooks.py:73`, `:296`, `:309`; `src/rox_cookbooks/host.py:322`),
  the venv install marker (`src/rox_cookbooks/kernel.py:708`) and the optional install log
  (`:691`, off by default — §2.6). None of these carries a store value.
- **The run-all temp files carry no secret value.** A `/run-all` writes a driver script, a job JSON
  and a `results.json` into a per-run temp dir (`execute_all`, `src/rox_cookbooks/kernel.py:1424-1444`).
  The job JSON holds the secret env **names** only (`secret_env`; the values stay in the child's
  environment), is created `0600` and is unlinked by the driver as soon as it has read it;
  `results.json` is written with the secret values already masked (§5.4), so a kill mid-run leaves
  neither file holding a raw secret. The whole temp dir is removed when the request returns
  (`:1474`).
- **Contract consequence:** the desktop layer that materialises the store file is responsible for
  creating it **mode `0600`** (POSIX) and for its directory being `0700`. The Lab performs no
  `chmod`/`umask` and never tightens permissions — verified: no `chmod`, `os.chmod`, `umask` or
  `st_mode` anywhere in `src/` or `scripts/`. On Windows, rely on the per-user profile ACL.
- **Proposal.** Electron should prefer `POST /store` over a file on disk (no secret ever lands
  anywhere), or write the file inside the app's user-data directory with `0600` and delete it on
  exit.

### 5.3 Injected into the kernel process only

- Secrets reach a cell as **process environment for the one-shot kernel only**
  (`docs/spec.md:29`): `env_for_item` builds the dict (`src/rox_cookbooks/secrets.py:10-22`),
  `_subprocess_env` layers it over the allowlist (`src/rox_cookbooks/kernel.py:99-108`), and
  `Kernel._process_env` is what `Popen(env=…)` gets (`:1004-1009`, `:948-958`).
- Nothing writes secrets into notebook JSON: persistence writes only redacted `stdout`/`stderr`
  and the cell source (`persist_code_output`, `src/rox_cookbooks/notebooks.py:119-147`, called from
  `src/rox_cookbooks/kernel.py:1122`).

### 5.4 Redaction (best-effort)

- Both captured streams and the derived `error` are passed through `redact_output`
  (`src/rox_cookbooks/secrets.py:65-75`; applied at `src/rox_cookbooks/kernel.py:979-989`). It
  replaces **known secret values** longest-first with `***`, using the values laid over this cell's
  final env — i.e. exactly what was injected.
- **Run-all redacts before the temp write (G4-CBK-01).** The run-all driver is handed the secret
  env **names** in its job JSON (`secret_env`) and reads the values from its own environment; it
  masks them from each record **before** appending that record to the temp `results.json`
  (`_RUN_ALL_DRIVER`, `src/rox_cookbooks/kernel.py:881-956`; job payload built in `execute_all`,
  `:1402-1432`). A run killed mid-flight — `/cancel` or the overall timeout — therefore cannot
  leave a raw secret on disk. The caller-side redaction (`:1465-1466`) stays as defense in depth.
- Redaction is **best-effort** and only sees the captured streams (`docs/spec.md:121`). It does not
  cover: files a cell writes, subprocesses that print to a tty, values a vendor SDK re-encodes, or
  network egress. Do not describe it as a guarantee.
- Redaction is applied **before** persistence, so the value written into the ipynb is the redacted
  text (`src/rox_cookbooks/kernel.py:988-989` → `persist_code_output`,
  `src/rox_cookbooks/notebooks.py:119-147`).

### 5.5 Missing credentials

- Presence is decided by `missing_secrets` (`src/rox_cookbooks/secrets.py:25-36`). The banner data
  is `GET /banner/<itemId>` → `{"missing": [...]}` (`src/rox_cookbooks/host.py:189-196`) and is also
  inlined as `missing` on `/document/*` and `/run` (`:368`, `:294`).
- A cell whose traceback looks like a missing-env or 401 error is rewritten into an actionable
  message naming the keys (`rewrite_missing_secret_error`, `src/rox_cookbooks/secrets.py:46-62`;
  applied at `src/rox_cookbooks/kernel.py:1117-1120`), e.g. "Missing ROX credential(s): openai.api_key.
  Add them in ROX credentials, then rerun this cell."
- The banner stays until the store changes: after the user adds a credential, `POST /store` and
  re-render the chips/cards (`src/rox_cookbooks/host.py:347-356`; `README.md:35`).

## 6. Failure modes & UX

| Failure | Host behavior | Electron UX |
|---|---|---|
| Missing credential | `/run` returns 200 with `missing:[…]` and a rewritten `error` (`src/rox_cookbooks/host.py:289-295`; `src/rox_cookbooks/secrets.py:46-62`) | Warn banner naming the keys + "add in ROX credentials", keep Run enabled (`docs/spec.md:18`) |
| No Python >= 3.11 | `/run` 400 `{"error": "<no-python message + install link>"}` (`KernelError` → 400, `src/rox_cookbooks/host.py:287-288`; message `src/rox_cookbooks/kernel.py:288-293`) | Blocking banner with the python.org link (`docs/spec.md:112`) |
| pip install fails | 400 with the command + pip log inline in `error` (`src/rox_cookbooks/kernel.py:606-612`) | Progress/install panel with the log and a retry (`docs/spec.md:113`) |
| Port in use | `start()` calls `ThreadingHTTPServer(...)` on port `0`, so the OS picks a free port; a bind failure raises out of `start()` and `serve_lab.py` dies with a traceback (`src/rox_cookbooks/host.py:360`; `scripts/serve_lab.py:25`) | Treat "no startup line within N s" as a failed launch; surface stderr and retry (§2.5) |
| Kernel/cell crash | One-shot process; `execute` never raises — returns `ok:false` with `stderr`/`error` (`src/rox_cookbooks/kernel.py:934-1002`, `:1145-1157`) | Cell shows the error; rerun the cell (no restart action in v1, `docs/spec.md:49`) |
| Cell timeout | Killed as a process tree, `timed_out:true`, timeout message (`src/rox_cookbooks/kernel.py:971-974`, `:1146-1150`) | Show "timed out after Ns"; suggest raising the timeout |
| Corrupt ipynb | `/document` 400 `{error, reset:true}` (`src/rox_cookbooks/host.py:201-202`) | Offer Reset (`docs/spec.md:116`) |
| Catalog file missing | Item stays, flagged `disabled` + `disabledReason:"file missing"` (`src/rox_cookbooks/catalog.py:122-130`; cards `src/rox_cookbooks/ui.py:80-84`) | Render the card disabled with the reason; other items unaffected |
| Unsupported item (GPU/Docker) | `/run` 400 `{"error":"no kernel for this item"}` (`src/rox_cookbooks/host.py:245-246`) | No Run button (`docs/spec.md:135`); CLI exits 3 (`src/rox_cookbooks/ui.py:248-250`) |
| Markdown item | `/run` 400 (`:245-246`); `/save` takes `{text}` (`:316-325`) | Render as a document, no Run-all; CLI exits 4 (`src/rox_cookbooks/ui.py:251-253`) |
| Bad `--store` JSON | `ValueError` at startup (`src/rox_cookbooks/ui.py:141-144`) → traceback, non-zero exit | Fail the launch with the message; a missing file is fine (§5.1) |
| Body too large | 413 before reading (`src/rox_cookbooks/host.py:30`, `:131-132`) | Client-side guard; show "too large" |
| Cross-site/bad Host | 403 (`src/rox_cookbooks/host.py:100-115`, `:168-169`) | Should never happen for a loopback URL; log it as a bug if it does |

Notes:

- **Exit codes of the CLI mirror the same rules** and are useful for a headless smoke:
  `run` → 0 ok / 1 failure / 3 unsupported / 4 markdown / 5 no code cells;
  `reset` → 6 on refusal (`src/rox_cookbooks/ui.py:246-286`; `README.md:54-55`).
- **No unexpected 5xx.** The single 5xx is `503 {"error":"host is shutting down"}` for a
  `/run`/`/run-all` that arrives after `LabHost.stop` began (`src/rox_cookbooks/host.py:92-102`);
  every other failure is 4xx. If Electron wants to distinguish "the sidecar is broken" from "your
  request was wrong", it cannot do so from status alone today. **Proposal.** Add a 5xx mapping for
  internal errors (`plans/011-host-input-safety.md:109-112` suggests doing it in one place).
- **Timeouts.** The HTTP host has no request timeout; the only timeout is the cell limit
  (`Kernel`, default 60 s, `src/rox_cookbooks/kernel.py:888`, `:943`). **Proposal.** Set an HTTP
  client timeout ≥ the cell timeout, and pass an explicit cell `timeout` from the UI.

## 7. Open questions / decisions needed

1. **Page auth.** Should `GET /lab.html` stay unauthenticated on loopback (`src/rox_cookbooks/host.py:172-174`)?
   If not, Electron needs a header-based way to load the page (a top-level navigation cannot set
   `Authorization`), so the fix is coupled with the framing decision (4).
2. **Token transport.** Header only, query only, or both (today: both, `src/rox_cookbooks/host.py:93-98`)?
   If both, confirm the `Referer`/history exposure is acceptable given `no-referrer`/`no-store`
   (`:117-123`).
3. **Token rotation.** Fixed for the process lifetime today (`:71`). Do we want a TTL or a
   rotate-on-focus/`POST /token/rotate`? What is the threat model on a single-user loopback host?
4. **Container.** Top-level `BrowserView`/`WebContentsView` (works with today's
   `X-Frame-Options: DENY`, `:121`), or relax framing for the ROX origin?
5. **Discovery.** Stdout line only (`scripts/serve_lab.py:26`), or also a discovery file
   (`{port,token,pid}`) so a supervisor can re-attach after a missed line (§2.2)?
6. **Shutdown.** SIGINT only today (`scripts/serve_lab.py:27-32`). Add a SIGTERM handler and/or a
   token-gated `POST /shutdown`? Who interrupts in-flight kernels (`KernelManager.shutdown` exists
   unused, `src/rox_cookbooks/kernel.py:1061-1066`)?
7. **Health route.** Add `GET /healthz` with version/uptime, or keep probing `/lab.html` + `/catalog`
   (§2.3)?
8. **Restart policy.** Who supervises the sidecar — Electron main, launchd, or the user? Backoff,
   max restarts, and the user-visible state when the budget is exhausted (§2.5).
9. **Store materialisation.** `POST /store` (no secret on disk) vs a `0600` file written by Electron
   (§5.2). If a file, where does it live and when is it deleted?
10. **Store freshness.** "Add the credential in ROX, rerun the cell" (A5, `docs/spec.md:133`) —
    who calls `POST /store` after the credential changes, and at what cadence? Is a file watch or an
    IPC event available from the ROX credential store?
11. **Ambient-env fallback.** `secrets.py:15` falls back to `os.environ` when the store is `None`;
    the host always passes a dict (`host.py:273`, `:368`). Confirm Electron paths always pass a dict
    so an undeclared host variable can never be read, and document the CLI's `--store`-less
    behavior (`README.md:26`).
12. **Install/log visibility.** `/run` drops `install_log` (`src/rox_cookbooks/host.py:289-295`).
    Add it to the response, or write a log file under the workspace and return its path (§2.6)?
13. **Kernel model.** Keep the one-shot `python -c` transport (`src/rox_cookbooks/kernel.py:856-869`)
    or take on the ipykernel/ZMQ spike (`docs/spec.md:143-145`)? This changes token, lifecycle and
    the per-copy contract — decide before building sidebar features that assume persistent state.
14. **Copy identity.** `POST /open` resumes the newest copy for an item unless `newCopy:true`
    (`src/rox_cookbooks/copies.py:62-68`; `_latest`, `:151-164`). Does the sidebar expose "New copy"
    and/or a copy switcher, and does it need a `GET /copies/<itemId>` listing?
15. **Error taxonomy.** No 5xx today (§6). Decide the mapping (400 vs 5xx) before Electron builds
    retry logic on top of it.
16. **Access log.** The host logs nothing (`src/rox_cookbooks/host.py:90-91`). Do we want a
    diagnostic log file for support, and where does it live?

## 8. Probe

`scripts/electron_handshake_probe.py` spawns the sidecar exactly as Electron main must (ephemeral
port, read the startup line, HTTP over loopback), asserts §3.3's table plus the security headers and
clean SIGINT shutdown, and exits 0 on success / 1 on failure:

```bash
python3 scripts/electron_handshake_probe.py            # default: fresh temp workspace
python3 scripts/electron_handshake_probe.py --workspace /tmp/lab-probe
```

Expected output (this machine, 2026-10-14, Python 3.9.6 — run verbatim, port/token/pid differ
per run):

```text
[INFO] spawned /Library/Developer/CommandLineTools/usr/bin/python3 /Users/t/Projects/2026-10-13-rox-cookbooks-notebooks/scripts/serve_lab.py --workspace /var/folders/dp/lbmf8rn9481fygd3687q6dvw0000gn/T/rox-lab-probe-yprep1x1 (pid 41608)
[PASS] sidecar prints its loopback URL at startup — first stdout line: 'http://127.0.0.1:53571/lab.html?token=Vp8nKRpGFFowEL0dgFnlbFyV6sxoxyot'
[PASS] startup URL carries a token — port=53571 path=/lab.html
[PASS] GET /lab.html without token -> 200 (page is not token-gated) — status=200
[PASS] lab document served — 9983 bytes
[PASS] GET /lab.html?token=<token> -> 200 — status=200
[PASS] GET /catalog without token -> 401 — status=401
[PASS] GET /catalog with wrong token -> 401 — status=401
[PASS] GET /catalog with Authorization: Bearer <token> -> 200 JSON array — status=200 items=13
[PASS] GET /catalog?token=<token> -> 200 JSON array — status=200 items=13
[PASS] framing/cache security headers present — X-Frame-Options=DENY, Cache-Control=no-store, X-Content-Type-Options=nosniff, Referrer-Policy=no-referrer
[PASS] unknown route -> 404 — status=404
[PASS] SIGINT stops the host cleanly (exit 0) — exit code=0
[SUMMARY] 0 failed
```

Exit status 0.

The probe does not import product code — it exercises the process boundary only, which is the
boundary this document describes.
