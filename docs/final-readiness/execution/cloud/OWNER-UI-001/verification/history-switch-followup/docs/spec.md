# UI-001 history-switch lease recovery

Input revision: `42034d8deb617630f923be8f61b33c72c05ed782`. This is a follow-up to the already merged UI-001 repairs; the original Requirements, DoD, Full functional verification and Test method are unchanged.

Integration base: `14cf6c561a4c39c47658ab1566e61c200041f649`, retaining the intervening upstream UI-001 workspace-mismatch, selection, panel restoration and sidebar synchronization changes. The baseline is bound to42034; the green proof uses the committed integrated repair.

When browser history requests another workspace, URL synchronization is suppressed until that switch finishes. If the switch returns false or rejects after a panel focus change, the still-current history request must release its suppression and synchronize the current workspace and focused panel. Focus changes still invalidate deferred create/prefill/send actions.

Every newer popstate request owns a new history reconciliation lease. A superseded failed switch must not release a newer cross-workspace lease. Returning to the current workspace while a switch is pending must reconcile that new URL and release the old suppression without waiting for the superseded callback. Owner replacement and unmount continue to fence stale callbacks.

Local workspace transitions and layout disposal invalidate history leases synchronously. Remote-only action-owner rotation preserves the local-workspace history lease, so a still-current failed switch can release its suppression. All action owner and focus-ABA guards are retained.

Acceptance: execute the actual production popstate callback in isolated regression tests and the mounted production NavigationProvider with React, Jotai and browser history. Preserve the failing baseline, exact source/input/bundle hashes, original timeouts, and explicit test-fixture limits. This proof does not establish installed Windows, packaged macOS, hosted web or real-provider acceptance; `fullDoDClosed` remains false.

StrictMode effect replay must resume an already-completed restoration under its new history lease. The continuation must retain the previous semantic key, preserve explicit navigation before the frame, and reject disposed leases, cross-workspace switches and deferred restoration. Original task Requirements, DoD, Full functional verification and Test method remain unchanged.
