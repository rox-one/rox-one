# Next-program decision records (ticket 14)

Written product/legal bindings. **Not code.** A human owner must flip
any of these; an agent must not invent a legal or product change.

Each record states the **current shipping binding** and what would be
required to change it. Status `OPEN` means a human decision is still
required before any flip. Status `ACCEPTED` means the current binding
is recorded so the next agent does not “fix” it.

| # | Topic | Binding | Status | Owner |
|---|---|---|---|---|
| [001](./001-g2-managed-siyuan.md) | G2 managed SiYuan | Stay **A (external-local)** | OPEN — legal/commercial | product + legal |
| [002](./002-wechat-ilink.md) | WeChat iLink | **Keep with warning** | ACCEPTED (current ship) | product |
| [003](./003-cloud-runs-auth.md) | Cloud Runs auth | **Keep shared bearer** | ACCEPTED (current ship) | product |
| [004](./004-appid-auto-update.md) | appId / auto-update | **No bridge date** — stay Craft-branded | ACCEPTED (current ship) | product |
| [005](./005-website-client-id.md) | Connect `clientId` flip | Blocked on private website repo | OPEN — access | product |
| [006](./006-branch-deletion.md) | Remote branch deletion | **Do not execute** §5 | ACCEPTED (current ship) | product |

Human owner for this program: **pzd** (`go@trysota.ru`). Legal review for 001 is still outstanding.

These records do **not**:

- flip G2 to B or C
- delete the WeChat iLink adapter
- schedule a Cloud Runs JWT migration
- change `appId` / `productName`
- flip the default Connect `clientId`
- delete remote branches
