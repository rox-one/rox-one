---
name: keeper
description: "Work with the local ROX Keeper secret vault through the `keeper` MCP tool or `craft-cli keeper`. Use to list, look up, create, update, or delete vault items without ever echoing a secret."
alwaysAllow:
  - keeper
---

# keeper

ROX Keeper is the user's local password/secret vault. Items are addressed by
`id`; projections are masked by default and a real secret is surfaced only
through an explicit, operator-authorized reveal.

## Golden rules

1. **Never echo a secret.** No password, TOTP secret, or revealed value in your
   reply, in a file, in a commit, or in a log. If you retrieved it, use it and
   forget it.
2. **Prefer references.** Pass an item `id` (or a folder/title) around instead
   of a value. Create an item once and refer to it by id afterwards.
3. **Reveal is opt-in, twice.** A secret is returned only when BOTH the tool
   call sets `reveal: true` AND the operator has exported
   `ROX_KEEPER_ALLOW_REVEAL=1`. When the flag is missing the call is refused —
   do not try to work around it.
4. **Never guess or fabricate** an item id, credential, or TOTP code. `list` and
   `get` are the only sources of truth.

## MCP tool

Call the `keeper` tool with an `action`:

| action   | required args        | notes                                             |
| -------- | -------------------- | ------------------------------------------------- |
| `list`   | — (`folder` optional)| masked items                                       |
| `get`    | `id`                 | masked view; add `reveal:true` + `field` for a value |
| `create` | `item`               | `item` has `kind`, `title`, and optional fields    |
| `update` | `id`, `patch`        | patch fields; `clearPassword`/`clearTotpSecret` remove |
| `delete` | `id`                 | destructive — confirm intent first                 |

Reveal only what the task needs, in the narrowest call possible.

## CLI

```sh
craft-cli keeper list [--folder <name>] [--json]
craft-cli keeper get <id>            # masked
craft-cli keeper status
craft-cli keeper delete <id>
craft-cli keeper create --title <t> [--username --password --url --notes --folder --totp]
# reveal (needs the operator flag AND --reveal):
ROX_KEEPER_ALLOW_REVEAL=1 craft-cli keeper get <id> --reveal [--field password|totp]
```

When a secret flag is omitted, `keeper create` reads it from piped stdin, so the
value never lands in shell history or process args.

## When NOT to use

- Do not move secrets into notes, code, or environment files.
- Do not reveal a value just to "check" it; `get` alone shows `hasPassword` /
  `hasTotpSecret`.
- If the vault is locked or its key is unavailable, report the exact error code
  (e.g. `keeper-vault-locked`) instead of retrying blindly.