# WP-48: explicit dependencies for the delayed checker fixture

Выбрано автономно. Root v3 failed16/1/143 because the exact three checker modules copied to an isolated temporary directory had no TypeScript package ancestry. A separate same-byte control returned Bun package-resolution exit1 before writing any audit; the original failure log is preserved at `/tmp/rox-wp48-v3-root-domain.log`.

Only the delayed-checker test fixture now links its explicit installed readonly dependency directory. The production checker bytes, bound module hashes, protected registry, server policy and every existing assertion remain unchanged. Root normal-source rerun passed17/0/146, including actual live session expiry after checker admission. The outside producer had explicitly resolved imports, so its prior passes were fixture-resolver evidence and did not replace this root gate.

Native-v1 remains held after independent validator/privacy findings; Full DoD and legal approval are not claimed.
