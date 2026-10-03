# Owners and dependencies

1. spec_review: reproduce focus-only false/rejected switches and supersession controls using the existing mounted actual NavigationProvider fixture. Own only its UI-001 browser test file; preserve baseline failure and input receipts.
2. patch_scout: independently review history lease ownership and add an isolated AST-extracted actual popstate callback regression. Own only the new UI-001 history-switch test.
3. Root: integrate the smallest source fix, preserve the action-owner fences, connect the callback regression to existing CI, run qualified typecheck and mounted verification on frozen source, and commit/push a separate PR. Depends on completed baseline probes from1 and2.
4. Root: read back the successful CI source tree, merge the expected PR head under the user's explicit authorization, record actual merge/main ancestry and source identities, and finish the public evidence package. The previously recorded native8e proof remains bound to its original source.

No unrelated source, auth store, global configuration, credentials, provider, signing or deployment work is part of this follow-up.
