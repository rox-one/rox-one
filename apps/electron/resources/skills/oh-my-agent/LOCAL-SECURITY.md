# ROX local helper security review

Reviewed against CodeQL analysis 1885378174 (source 2af860c5783dd4dd24209f030d119aeaf2e212e8).

| Alerts | Disposition | Evidence |
| --- | --- | --- |
| 809/810: flatten-tables pathname race | Fixed: document is opened once with `O_NOFOLLOW`/`O_NONBLOCK`; regular file and unchanged pathname/inode/content metadata are checked; read, write and truncate use that descriptor. No permission or document conversion policy change. | `browser-helper-security.test.ts`: UTF-8/truncation, unchanged result, transform failure, final symlink and pathname replacement negative controls. |
| 924: missing origin check | Fixed: presenter messages require the same-origin parent window and a nonnegative safe integer index. | Actual shipped controller executed in a VM; foreign window/origin, invalid indexes rejected and same-origin parent accepted. |

No scanner exclusion or dismissal applied. Remote scanner closure remains a separate result.
