# UI-001 continuation specification

Input: rox-one/rox-one at 76228cc33e44518e5fab5e59f5c754f4051d1e8c plus Cloud task task_e_6ac0cdc452fc8326a60409e40d92a0c6 attempt 1. The original UI-001.1 and UI-001.2 contract is preserved verbatim in verification/original-contract.json.

Scope: the three originally owned renderer files, new rox-readiness-ui-001.* tests, and this OWNER-UI-001 directory. Preserve original failure history. No shared parser, translations, auth, root metadata, lockfile, deployment, signing, provider side effects, push/PR or main changes. The original do-not-delegate constraint is retained; the current agent is the sole writer and reviewer of source evidence.

Observable acceptance for this bounded continuation:
1. Real geometry atoms normalize both live and persisted direct/functional updates; malformed reload and external storage events recover; unavailable/quota-failed storage cannot break resizing.
2. Real route host identity follows workspace and entity, isolates asynchronous responses after navigation, and preserves the selected route on deletion where the owned host can observe it.
3. Actual source/skill load/subscription callbacks reject obsolete workspace and working-directory responses and cannot overwrite a newer deletion snapshot.
4. Execute the named regression entry point and typecheck with Bun 1.3.14/frozen dependencies. Preserve pre-existing failures and precise cross-platform limits.

Full DoD requires original installed Windows 10/11, native macOS, authenticated hosted browser, backend state readback and immutable integrated candidate replay; local fixtures do not close it.
