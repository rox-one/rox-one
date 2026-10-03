The browser suite mounts the production `App`, its route providers and domain pages. The API uses the production WebSocket client, channel map, server transport, native authority, native journal, Notes handlers, main replica queue, and preload replica bridge. Test adapters provide shell configuration, throwaway enrollment/credentials, and an in-process IPC sender. These adapters and markers live under `tests/` and `scripts/product-tour/`; they are not application production entrypoints.

Browser application success establishes UI → transport → native commit → canonical read-back for the exercised operation. The baseline `notes.LIST_ASSETS` handler does not declare `nativeAction` and denies native callers, making the unadapted Notes UI unavailable. That baseline defect is recorded as blocked; the harness does not substitute successful accessory inventory. It does not establish Electron IPC sender identity, OS credential custody, packaged app behavior, microphone permission prompts, macOS, or Windows. The native suite launches only `apps/electron/dist/main.cjs` with a generated profile; Linux returns `NOT_RUN` and exit 2.

Commands from the repository root:

```sh
CHROMIUM_EXECUTABLE=/usr/bin/chromium bun run test:product-tour:e2e
bun test apps/electron/src/renderer/features/product-tour/__tests__/integration
bun run test:product-tour:native
bun scripts/product-tour/bundle-report.ts /path/to/baseline/apps/electron/dist/renderer
```

`step-matrix.json` specifies all 56 expected policies. `catalogue-policy.test.ts` imports and executes the production reducer and production catalogue; every atomic ID has a positive policy case and a premature/foreign-event case. These are pure evidence checks. Verified signals supplied to the reducer are synthetic and do not claim that the corresponding domain operation succeeded. Domain operations require their own application or native evidence.

Native manual evidence must record the candidate SHA, OS/build, action sequence, result, and supporting capture. On macOS inspect Start/Pause/Resume, the native menu, file picker focus, and existing sharing dialogs. On Windows inspect Start/Pause/Resume, Git Bash prerequisite/setup, menu and drawer focus. On both deny the microphone permission after an explicit voice action; verify no recording before consent and that ordinary typing still works. The automated fresh-setup smoke is narrower than these manual cases.
