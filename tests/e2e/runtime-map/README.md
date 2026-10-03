This isolated fixture uses the production `ChatDisplay`, `ChatRuntimeSplit`, `RuntimeMapDock`, ingress/projection, persistent journal and snapshot/cursor/payload service. Its executor is explicitly deterministic. Only the harmless fixture Bash command runs as a real subprocess. It performs no provider requests and does not simulate a successful native worker loop.

Run from the repository root with pinned project Bun and Playwright 1.49.1:

```sh
bun test tests/e2e/runtime-map/journal-harness.test.ts
ROX_TEST_BUN=/absolute/path/to/bun node node_modules/@playwright/test/cli.js test --config tests/e2e/runtime-map/playwright.config.ts
bun run scripts/bench/runtime-map.ts
```

The browser command builds an actual release renderer before serving it. Ordinary stream/permission/welcome tests record WebM. Performance tests disable recorder/traces so snapshot traversal cannot inflate the budget. `ROX_RUNTIME_PROFILE=1` enables diagnostic CPU profiling; those measurements are marked instrumented. Raw artifacts go to `docs/evidence/runtime-map/browser-artifacts/` and the final JSON reporter to `docs/evidence/runtime-map/browser-results.json`.

The test server requires explicit `ROX_RUNTIME_MAP_E2E=1`, refuses production mode, binds IPv4 loopback only and uses a disposable temporary session directory. No real workspace or credential store is read or changed. Starting/reopening the map, searching and filtering must not increment runtime/tool/provider calls. See the independent evidence matrix for unsupported environments and unresolved acceptance requirements.
