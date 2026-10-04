# OMP stdio-close follow-up

The production adapter now waits for the child’s stdio close before finishing the protocol decoder and detaching ownership. The existing 250 ms fallback remains for inherited pipes; it closes this attempt’s reader without claiming EOF. Startup failure settles immediately at that same boundary, retaining the latched stderr signature and startup-generation fence.

The actual-callback negative control passed one case and failed six on the old source. The late first chunk produced `OMP subprocess exited unexpectedly (code 0)` instead of exact truncation. The repaired deterministic suite passes seven cases / 29 assertions. The focused collision passes 80 cases / 414 assertions across eight files, including the unchanged 18 transport cases, startup, session flow, query, permission changes, public runtime and hidden-window behavior.

`result.json` records exact input hashes, commands, runtime, actual exits, process cleanup, independent review and qualifications. `log-manifest.json` binds five compressed logs; `failure-history.json` retains the remote two-case failure and all earlier onboarding history. The final seven-case replay uses the exact final source bytes after an explicitly recorded comment correction and canonical lifecycle-note update.

Each command uses pinned Bun 1.3.14, Node 24.21.0 on PATH and a nonexistent ambient `OMP_CLI_PATH`. Existing internal eight-second chat limits and exact error/model/payload/frame assertions remain unchanged. The collision’s `--timeout 30000` is only the outer test-case allowance. The deterministic suite has no executable/provider or global module/clock mock; it extracts the actual production registration statements and uses actual agent handlers, codec and readline.

This receipt binds uncommitted working-tree source over `b91f9ef55405794f3f53bcc904066e3aaa06fe4a`. Root owns commit, exact onboarding integration, current remote CI and merge readback. No current installed-app/native/provider or full-DoD claim is made; `fullDoDClosed` remains false.
