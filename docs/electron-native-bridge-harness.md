# Real Electron native bridge harness

This developer command probes a bounded composition of production preload, real Electron IPC, authenticated native WebSocket RPC, authority/journal and encrypted replica outbox. It is **not a packaged product UI E3 test**, OS secure-store acceptance, provider test or platform matrix.

Run from a checkout with its declared dependencies already installed. The harness resolves the repository from its own source location and the Electron executable from the installed `electron` package. It uses existing `esbuild`; it never installs dependencies or changes global package commands.

```sh
# Existing standard build prerequisite; rebuild after preload-source changes.
bun run electron:build:preload

# Choose either entry runtime. Output directories must be new.
bun scripts/tests/electron-native-bridge/run.ts --output /tmp/rox-bridge-bun-report
node --experimental-strip-types scripts/tests/electron-native-bridge/run.ts --output /tmp/rox-bridge-node-report

# Scoped strict type check using the existing compiler.
bun run tsc --noEmit -p scripts/tests/electron-native-bridge/tsconfig.json
```

Without `--output`, a new report directory is allocated under the OS temporary directory and printed. An existing supplied directory is refused. Fixture profiles and synthetic state are separate runner-generated canonical temporary roots, never a supplied profile, HOME or real workspace. The runner deletes only its own fixture root. Reports retain the service bundle, source/preload hashes, stdout, phase results, actual Electron main PIDs, exit/signal/timeout state and cleanup receipt. Generated private credentials/keys remain mode0600 inside the fixture root and are removed; they are not report artifacts. Do not publish generated logs as real user/profile evidence.

The production preload must already exist at `apps/electron/dist/bootstrap-preload.cjs`. Absence stops before Electron starts and points to the existing build command. Its SHA256 is bound before and after; this binds the actual loaded bytes, not a claim that arbitrary preexisting output is fresh. The helper service is compiled from this checkout using the Electron tsconfig paths, so a borrowed dependency cache does not select another checkout's production sources. The installed external SDK entry is separately hash-bound to preserve its native ESM initialization; no SDK query is called.

The child environment is an explicit whitelist: supported ROX_CONFIG_DIR/CRAFT_CONFIG_DIR, generated fixture inputs, PATH and necessary OS/display variables. HOME, authentication, provider and keychain variables are not forwarded. The fixture sets its own Electron profile paths, uses hidden muted windows, and prohibits application activation on macOS. It uses the existing production `contextIsolation:true`, `nodeIntegration:false`, `sandbox:false` compatibility settings. A sandbox-true acceptance is not claimed.

The three actual Electron main processes cover:

1. Production create pipeline → canonical revision1 → pending0 after its observed exact receipt.
2. Creation plus one encrypted unsubmitted mutation → normal child quit.
3. Fresh process reads the same stable queued operation, commits revision2 through authenticated RPC, accepts only the preload-observed exact receipt and returns pending0 with exact canonical content.

Single/replay also attempt a complete matching public-digest forged receipt and require the specific unobserved-receipt rejection with pending1 and unchanged journal count. Revocation must deny open/enqueue/mutate with unchanged canonical bytes and receipts. A second genuinely managed BrowserWindow calls the real private main IPC and is denied the first window's handle, including after that owner is destroyed. The latter verifies denial after destruction; because the caller is already foreign, it does not isolate destruction cleanup causality.

Task adapters are explicit: a synthetic local operator bootstraps/enrolls only the generated authority state; minimal main bootstrap channels supply the synthetic transport credential; native replica credentials use the existing dependency-injection seam with generated keys persisted for replay. This is **not full product main wiring or OS credential custody**. The positive preload/IPC/WS/authority/journal/replica implementation is production code. A separate tiny negative-control preload only invokes real IPC from the second sender.

Readiness and limits:

- Electron must be installed and runnable in the current OS/display session. A hidden BrowserWindow still requires supported display infrastructure on Linux. The harness does not install a display server or silently add global `--no-sandbox` flags.
- Node must support TypeScript stripping for the Node runner command; the installed Electron's Node must support the production SQLite APIs. Native service TS is compiled to CJS rather than treated as direct Node source-module execution. A separately investigated CJS/source SQLite adapter is not silently transplanted or accepted here; module/runtime incompatibility is a failed readiness result with retained logs.
- The process deadline is a failure backstop. Successful recovery uses normal application quit and fresh processes, **not SIGKILL, response loss or power loss**.
- No provider/model request, media capture/speaker operation, visible UI flow, paid-runtime, mobile/platform, signing or release acceptance is established. Product UI E3 and real OS key custody remain separate gates.
