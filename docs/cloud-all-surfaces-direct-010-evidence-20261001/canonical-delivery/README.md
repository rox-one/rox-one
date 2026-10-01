# Exact010 canonical Linux delivery verification

Candidate: `010fa8c040e3a84cd40cd8195473f52d8582f159`.

Use `summary-complete.json` as the final PASS receipt. `verification-receipt.json` and `final-verification-receipt.json` preserve the initial RED harness attempts; they have not been overwritten.

- Canonical `bun --no-env-file run server:build --output=../../../workspace/rox-r15-direct-server-dist-20261001`: exit 0, **8.316 s**. Its mandatory Pi/cloud-runner/WhatsApp/Discord rebuilds were authorized in the isolated checkout. Pi and cloud-runner hashes are unchanged; the generated messaging bundles changed and their before/after hashes are retained.
- The canonical builder does not stage WebUI. An explicit output-only copy staged all **855** fresh exact010 UI files. Complete source/staged path, size and hash inventories match. No UI, Electron, or `dist-server` rebuild was performed by this verifier.
- Actual **`sh bin/craft-server`**: **2 PASS / 0 FAIL / 56 expect calls**, **9.704 s**. Exact retained helper assertions verified HTTP health/login/auth/config/HTML, HttpOnly cookie, invalid and valid WebSocket authentication, open-client SIGTERM shutdown, stopped endpoints, same-profile recovery, and short-token refusal. Test names, declaration lines and actual log lines are in `executed-cases.json`.
- Outer Bun **1.3.14**; actual bundled runtime **1.3.9**. These are distinct observations.
- Shipment closure: **57/57 checks PASS**, covering complete **2062** workspace files across nine packages, **113** selected resources, **2** Bun/uv binary comparisons, **855** UI files and **9** internal workspace symlinks. The complete **56505-file**, **1,105,833,914-byte** shipment and its symlink inventory are identical before and after runtime verification. Third-party dependency semantics are not separately certified by the inventory observer.
- All **6178** tracked source files, **2** gitlinks and lockfiles are preserved. All **856** live UI/server artifacts are preserved. Original `/workspace/rox-one` is unchanged and clean.
- Both normal launcher instances exited **0** after SIGTERM without SIGKILL; the short-token instance exited **1** before readiness. All three exited, all own private profiles were removed, and the verifier's temporary root was deleted. Shipment, shared checkout and dependencies remain for root verification and release.

Two observer invocations exited 2 because the separately generated closure observer was not yet available. They are retained as orchestration errors and were resolved after its explicit ready signal. A final evidence count parser also rejected Bun's whitespace/singular-file format; its receipt is `completion-parser-error-receipt.json`. The parser alone was corrected. No application assertions were changed, and the successful build, smoke and closure were not repeated.

Full safe command logs, child log, helper originals/path-only deltas, source snapshots, copy receipt, closure comparisons and full shipment hash manifests remain locally retained. `summary-complete.json` includes their sizes and SHA-256 values. No installed/native Electron, macOS, providers/OAuth, iOS, PG, full109/full143 or security-scan acceptance is claimed.
