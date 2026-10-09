# V6 — Service lifecycle runtime (slice S7)

- Verifier: `w1-verify-6`
- Repo: `/Users/t/Projects/rox-one-port` @ `cdcd4c50f` (branch `port/openclaw-features`, merged main PR #1643 / 9927e86eb)
- Host: macOS (darwin 27.0.0), uid 501, `bun` 1.4.x, `/bin/launchctl` present
- Method: real service modules driven from a throwaway `bun` script. Real filesystem
  (`createNodeServiceFilesystem`), real `/bin/launchctl` (`createLaunchctlRunner`), real
  loopback port probe (`defaultPortAvailable`). No source/test/config in the repo was modified.
  Sandbox HOME `/tmp/rox-verify-home`, disposable label **`com.rox.verify.probe`**.
- Rows covered: e1.4–e1.8, e2.1, e2.5.

Modules under test:
`packages/server-core/src/service/{launchd-plist,launchd-install,launchd-runtime,service-manager,node-fs,doctor}.ts`.

---

## Summary

| # | Claim | Verdict |
|---|---|---|
| a | install publishes plist + env (0600) + wrapper (0700) | **PASS** |
| b | mid-install failure rolls back to prior state, no partials | **PASS** |
| c | mutation refused inside service; system-path ownership refused | **PASS** |
| d | uninstall removes only its own artifacts | **PASS** |
| e | doctor runs for real, documented check set, correct findings | **PASS** |
| f | real launchctl bootstrap/kickstart/bootout | **PASS** (1 anomaly, see below) |

Reproduce (after writing the probe back to `/tmp/v6probe/probe.ts`):
```
cd /Users/t/Projects/rox-one-port && HOME=/tmp/rox-verify-home timeout 120 bun run /tmp/v6probe/probe.ts
```
Probe imports the modules by absolute path; nothing in the repo is touched.

---

## (a) install — artifact modes + secret isolation

`LaunchdService.install()` with `serviceDirectory=$HOME/service`, `launchAgentsDirectory=$HOME/Library/LaunchAgents`:

```
### install result            {"ok":true,"status":{"state":"installed","platform":"darwin","managed":true,"autostart":true}}
### modes (fs.stat & 0o777)   {"env":"0o600","wrapper":"0o700","plist":"0o600"}
### serviceDirectory mode     "0o700"
```
Equivalent `stat -f '%Sp %N'` on the published files:
```
-rw-------  …/service/service.env
-rwx------  …/service/service-wrapper.sh
-rw-------  …/Library/LaunchAgents/com.rox.verify.probe.plist
```

Secret isolation — the env file carries the secret, the plist does not:
```
env bytes:  "# ROX managed service environment (mode 0600). Generated; do not edit.\nROX_SERVICE_MANAGED='1'\nSECRET_TOKEN='s3cr3t-value'\n"
plist contains secret?  false
```
Env values are POSIX single-quoted (`shellQuote`); the plist `ProgramArguments` point at the
0700 wrapper, which SHA-256-verifies the env file before exec (exit 78 on mismatch).

**Verdict: PASS.** 0600 env / 0700 wrapper (and 0600 plist) confirmed on the real fs.

---

## (b) mid-install rollback transaction

`installServiceArtifacts` with a delegating fs that delegates every op to the real
`createNodeServiceFilesystem` **except** the final plist write, which throws ("simulate a later
step failing"). Artifact order = env, wrapper, plist (as in `LaunchdService.install`).

**B1 — prior state exists → exact restore:**
```
B1 thrown   {"name":"ServiceOperationError","code":"INSTALL_FAILED","message":"INSTALL_FAILED"}
B1 restored {"env":"# OLD ENV\n","wrapper":"#!/bin/sh\necho old\n","plist":"OLD-PLIST"}
B1 modes    {"env":"0o600","wrapper":"0o700","plist":"0o600"}
```
New bytes were written to env+wrapper before the plist step threw; the snapshot restored the
exact prior bytes **and** modes for all three.

**B2 — no prior state → no partials:**
```
B2 thrown {"code":"INSTALL_FAILED"}
B2 after  {"env":"MISSING(ENOENT)","wrapper":"MISSING(ENOENT)","plist":"MISSING(ENOENT)"}
```

**B3 — typed error is preserved (not swallowed into INSTALL_FAILED):**
```
B3 typed code preserved {"code":"INVALID_DEFINITION"}
```

**Verdict: PASS.** Rollback restores prior state and removes partial artifacts; a
`ServiceOperationError` from a step propagates with its own code
(`launchd-install.ts:82-86`).

---

## (c) fences

**c1 — inside-service refusal.** `LaunchdRuntime({isInsideService: () => true})`:
```
{"bootstrap":"ServiceOperationError:MUTATION_REFUSED","bootout":"ServiceOperationError:MUTATION_REFUSED","kickstart":"ServiceOperationError:MUTATION_REFUSED"}
```
**c1b — real default marker.** With `process.env.ROX_SERVICE_MANAGED='1'` (no injected override):
```
bootout -> "ServiceOperationError:MUTATION_REFUSED"
```

**c2 — system-path ownership refusal.** `LaunchdService` whose `plistPath` is
`/Library/LaunchDaemons/com.rox.verify.probe.plist` (outside the claimed
`~/Library/LaunchAgents`):
```
{"ok":false,"status":{"state":"failed",...,"safeError":"SYSTEM_DAEMON_CONFLICT"}}
nothing written under sandbox: serviceDir absent
```

**Verdict: PASS.** Both fences demonstrated (`launchd-runtime.ts:83-85`,
`service-manager.ts:50-54`).

---

## (d) uninstall scoping

Installed under `$HOME/d`, then planted a sibling label plist
(`…/LaunchAgents/com.rox.verify.other.plist`) and a foreign file
(`…/service/keep.txt`). `uninstall()`:
```
after: {"plist":"MISSING(ENOENT)","wrapper":"MISSING(ENOENT)","env":"MISSING(ENOENT)",
        "sibling":"0o600","keep":"0o600","serviceDir":"EXISTS"}
idempotent uninstall: {"ok":true,"state":"not-installed"}
```
The three owned artifacts were removed; the sibling plist, the foreign file, and the
`serviceDirectory` itself were untouched. A second uninstall on empty state is a no-op success.

**Verdict: PASS.** `removeServiceArtifacts` targets exactly the three owned paths
(`service-manager.ts:117-120`).

---

## (e) doctor — raw JSON on this machine

Real deps: `getServiceStatus` from a real `LaunchdService` (real `launchctl print`),
`isPortAvailable = defaultPortAvailable` (real loopback bind), `pathExists = existsSync`.

**E1** — installed (not loaded), 1 of 2 log paths present, configDir present, runtime not provisioned:
```json
{"generatedAt":1791526871883,"checks":[
 {"checkId":"service-state","severity":"warn","messageKey":"doctor.check.serviceState","detail":{"state":"installed","platform":"darwin"}},
 {"checkId":"port-conflict","severity":"ok","messageKey":"doctor.check.portConflict","detail":{"count":0}},
 {"checkId":"runtime-mismatch","severity":"warn","messageKey":"doctor.runtimeMismatch.detail","detail":{"app":"0.11.8","runtime":"none"}},
 {"checkId":"config-dir","severity":"ok","messageKey":"doctor.check.configDir","detail":{"path":"/tmp/rox-verify-home/e"}},
 {"checkId":"logs","severity":"ok","messageKey":"doctor.check.logs","detail":{"count":1}}]}
```

**E2** — port 19007 **really bound** by a listening socket; requested ports `[19007, 19008]`;
`runtimeVersion=0.11.0` vs app `0.11.8`:
```json
{"checks":[
 {"checkId":"service-state","severity":"warn",...},
 {"checkId":"port-conflict","severity":"error","messageKey":"doctor.portConflict.detail","detail":{"count":1,"ports":"19007"}},
 {"checkId":"runtime-mismatch","severity":"warn","messageKey":"doctor.runtimeMismatch.detail","detail":{"app":"0.11.8","runtime":"0.11.0"}},
 {"checkId":"config-dir","severity":"ok",...},
 {"checkId":"logs","severity":"ok","detail":{"count":1}}]}
```

**E3** — failed service, missing config dir, all logs missing:
```json
{"checks":[
 {"checkId":"service-state","severity":"error","detail":{"state":"failed","platform":"darwin"}},
 {"checkId":"port-conflict","severity":"ok","detail":{"count":1}},
 {"checkId":"runtime-mismatch","severity":"warn",...},
 {"checkId":"config-dir","severity":"warn","messageKey":"doctor.configDir.detail","detail":{"path":"/tmp/rox-verify-home/nope-missing"}},
 {"checkId":"logs","severity":"warn","messageKey":"doctor.logs.detail","detail":{"count":0}}]}
```

All five documented checks (`service-state`, `port-conflict`, `runtime-mismatch`, `config-dir`,
`logs`) are present, and severities track the real inputs (a genuinely bound port is detected;
a free port is not). **Verdict: PASS.**

---

## (f) real launchctl drive (gui/501)

Plist rebuilt with `RunAtLoad=false, KeepAlive=false` (harmless: wrapper execs `/usr/bin/true`).
`LaunchdRuntime` with the real `createLaunchctlRunner()`:
```
f install {"ok":true,"state":"installed"}
f trace   {"bootstrap":"ok","isLoadedAfterBootstrap":true,"kickstart":"ok","isLoadedAfterKickstart":true,"bootout":"ok","isLoadedAfterBootout":false}
```
`launchctl` was fully drivable in this environment (no sandbox block); the launchctl half is
therefore **driven, not merely file-level**. bootstrap loads the job, kickstart starts it,
bootout unloads it.

**Anomaly (low severity, launchd-side race):** `isLoaded()`/`launchctl print` queried
*immediately* after a successful `bootout` (exit 0) can transiently still report the job as
loaded. Reproduced 2/6 iterations with the tight bun-driven loop:
```
iter 1: loadedAfterBoot=true kickstart=0 loadedAfterKick=true bootout=0 loadedAfterBootout=true
iter 2: … loadedAfterBootout=false
iter 4: … loadedAfterBootout=true
```
Reproducer:
```sh
P=/tmp/rox-verify-home/f/Library/LaunchAgents/com.rox.verify.probe.plist
for i in 1 2 3 4 5 6; do
  launchctl bootstrap gui/501 "$P"; launchctl kickstart -k gui/501/com.rox.verify.probe
  launchctl bootout gui/501/com.rox.verify.probe
  launchctl print gui/501/com.rox.verify.probe >/dev/null 2>&1
  echo "iter $i print_after_bootout_exit=$? (0=falsely loaded)"
done
```
A pure-shell loop (inter-command overhead ≥ several ms) showed `113` every time, so this is a
settle-time race in launchd, not a defect in the module (`launchd-runtime.ts` faithfully
reflects `launchctl print`). Impact: `LaunchdService.getStatus()`/`stop()` immediately followed
by a status read can briefly report `running` after a successful `bootout`. Classified
**unproven as a product bug** — no source line can be indicted; it is a host-timing observation.

**Verdict for (f): PASS** (bootstrap/kickstart/bootout all work on the real surface), with the
race logged above.

---

## Cleanup proof (mandatory)

Removed the sandbox HOME and all probe scripts, and confirmed no disposable state remains:
```
$ rm -rf /tmp/rox-verify-home /tmp/v6probe
$ ls -d /tmp/rox-verify-home      -> sandbox HOME removed
$ ls -d /tmp/v6probe              -> probe scripts removed
$ launchctl list | grep -i verify -> no verify jobs loaded
$ launchctl print gui/501/com.rox.verify.probe  -> print_exit=113 (113 = gone)
$ find /tmp -maxdepth 2 -iname '*rox-verify*'   -> (empty)
$ ls ~/Library/LaunchAgents | grep -i verify    -> no probe plist in user LaunchAgents
```
The user's real `~/Library/LaunchAgents` was never written to (pre-existing `com.rox.*` /
`one.rox.*` / `com.agisota.*` jobs are the operator's own and were untouched). No port left
bound (19007 closed inside the probe).

## Blockers / limitations
- None blocking. The single anomaly (f) is a launchd settle-time race, reproducible but not
  attributable to a repo source location.