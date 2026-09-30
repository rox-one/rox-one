# Real optimized WebUI execution, revision bound

Executed application/build revision: `a4cacaa1d91c205de5d2c543d565e7edb79edd0e`. Final repository HEAD: `010fa8c040e3a84cd40cd8195473f52d8582f159`. The intervening diff contains only the settings test fixture and packaging script listed in JSON; 30 production fingerprints and all retained built entry/HTML/asset fingerprints still match. The execution is not relabeled as the final HEAD.

Actual command (fixed temporary layout; existing node_modules and `/usr/bin/chromium` required):

```sh
node /tmp/rox-ui-surface-discovery-20260930/ui-runtime/mounted-ui-union.cjs /tmp/rox-ui-surface-discovery-20260930/all-surfaces a4cacaa1d91c205de5d2c543d565e7edb79edd0e
```

Private runner receipt: `union-validation/r23-mounted-ui-browser.json`, true exit **0**, elapsed **598.753 s**. **99 checks passed, 0 failed, 0 phase errors; lifetime page exceptions 0 in both browser profiles.**

Bun 1.3.14, Node v24.19.0, Playwright 1.49.1, Chromium 151.0.7922.173. Chromium headless process flags are recorded; no TLS verification, environment policy, network permissions or production credentials were changed.

Fresh build commands:

```sh
bun --no-env-file run webui:build
bun --no-env-file build packages/server/src/index.ts --target bun --outdir dist-server --external xlsx
```

Both true exit0 (77.551 s and 1.231 s). Actual optimized HTML entry: `apps/webui/dist/assets/main-CdNrFgjS.js`. 386 reachable JavaScript files, no old generated entry chunks; 26 source-map sourceContent closures byte-match the checked-out production source. Exact entry/HTML/JS/maps fingerprints and copies are in `results.json` and `built-assets/sha256.json`.

Executed UI observations and available functional checks:

- Real authenticated HTTP login and HttpOnly cookie; HTTP default workspace matched real handshake ACK. No synthetic Workspace/host identity/native principal was added.
- Actual top header y=0, height40; seven visible mode buttons clicked with active state, expanded left ActivityRail with actual controls. Real Skip dismissed memory onboarding; real Collapse/Expand changed visible controls and persisted preference. Both rail widths intentionally remain44px.
- All22 root routes and22 settings pages render an actual surface marker/heading or explicit unavailable state, rather than merely surviving URL navigation. Default/explicit private Workbench preference states and a1024px viewport are separately captured.
- Missing native Notes transport displays explicit unavailable, does not mount editor/controller, and disables New note. A real mouse click and Enter produced no mutation channel or create dialog.
- A real UI New Page click persisted a genuine private page with production RPC. Its exact slug/id/config fields, browser reload and same-profile restart persistence are recorded. No agent/provider/source action was requested.
- Controlled server stop made health/login/api/config/HTML and WS endpoints unreachable. Same-profile restart retained old HttpOnly cookie/default workspace/private page, and a **new** socket acknowledged the same actual workspace.
- Actual URL workspace mismatch and fresh unconfigured profile refuse shell; no page exception.

Unavailable is not native functional acceptance:

- Host session inventory remains visibly unavailable; callerAuthority is null.
- Canonical native Notes editing/writer/outbox/receipt, native principal capabilities, local Project detail/Roadmap/RepositorySnapshot actions, separately authenticated shared Project authority, PostgreSQL receipts/adoption, provider/LLM, native terminal/browser/extension/diff/cloud-run contextual actions were not executed by this browser check.
- Real project/note fixtures are persisted in the private profile, but unsupported detail routes correctly render unavailable. These observations do not mark Native/DATA/SHARED or full DoD109/143 complete. Credential-backed WS/native tests belong to separate receipts.

Source vs infrastructure:

The b841 baseline had87 passed/12 failed checks and6 page exceptions: uncaught denied Notes/settings reads, missing native Notes transport and optional project preload subscription. The narrow UI capability/read boundaries now yield99/0/0 with no page exception; preserved native writers/controllers/approved hook bytes and lifecycle tests are independently reviewed. Observer-only rail-width and old-ACK assumptions were corrected separately. External Google Fonts DNS failures remain infrastructure observations; no network setting was changed. Local optimized assets/authenticated transport/rendering completed.

Cleanup: all3 owned servers were live before SIGTERM, actually received it, exited0 with no SIGKILL. Browser closed; all own private profiles/TMP and server processes are gone. Post-run profile/PID checks passed. No full ephemeral token appeared in server output; retained logs/JSON/HTML use secret redaction and cookie metadata retains flags only. The private profiles themselves are not retained.

Exact helper/provisioner copies: `executed-helper.cjs`, `executed-provisioner.ts`; hashes are in `evidence-sha256.json`.

Selected screenshots:

- [actual-activity-rail-user-expanded.png](actual-activity-rail-user-expanded.png)
- [actual-activity-rail-user-collapsed.png](actual-activity-rail-user-collapsed.png)
- [route-01-home.png](route-01-home.png)
- [settings-messaging.png](settings-messaging.png)
- [pre-existing-private-note.png](pre-existing-private-note.png)
- [genuine-project-roadmap.png](genuine-project-roadmap.png)
- [functional-created-private-page.png](functional-created-private-page.png)
- [functional-created-private-page-reloaded.png](functional-created-private-page-reloaded.png)
- [same-profile-restart-persisted-page.png](same-profile-restart-persisted-page.png)
- [negative-mismatched-url-workspace.png](negative-mismatched-url-workspace.png)
