# Telegram Flows

These are example self-hosted flows for local `tgchats` users.

## Morning Triage

1. `npm run dev -- whoami --json`
2. `npm run dev -- inventory summary --json`
3. `npm run dev -- inbox --location active --page-size 30 --json`
4. For top chats: `npm run dev -- open <peer> --json` and `npm run dev -- chat <peer> --limit 50 --json`
5. Suggest follow-up: `npm run dev -- nudge <peer> --style concise --json`

## AI-Assisted CRM Enrichment

1. `npm run dev -- tags suggest <peer> --json`
2. `npm run dev -- company suggest <peer> --json`
3. `npm run dev -- tasks suggest <peer> --json`
4. Persist only after user confirmation:
   - `... --apply --json`

## Summary Refresh

1. Single chat: `npm run dev -- summary refresh <peer> --json`
2. All chats: `npm run dev -- summary refresh --all --limit 50 --json`
3. Read summary:
   - `npm run dev -- summary show <peer> --kind rolling --json`
   - `npm run dev -- summary show <peer> --kind since_last_seen --json`

## Rules Workflow

1. Create rule:
   - `npm run dev -- rules add --name "<name>" --instruction "<instruction>" --tag Lead --followup-days 1 --json`
2. Preview rules:
   - `npm run dev -- rules list --json`
3. Run:
   - `npm run dev -- rules run --json`
4. Audit:
   - `npm run dev -- rules log --limit 100 --json`
5. Cleanup:
   - `npm run dev -- rules disable <rule_id> --json`
   - `npm run dev -- rules delete <rule_id> --json`

## Sync Worker Bootstrap

1. `npm run dev -- db migrate`
2. `npm run dev -- auth`
3. `npm run dev -- sync backfill --dialogs 200 --per-chat-limit 200`
4. `npm run dev -- sync once --mode full --include-archived --json`
5. If status is `waiting_for_telegram`, wait until `resumeAt`, run the same command again, and verify with `npm run dev -- sync status --json`.
6. Start `npm run dev -- sync tail --interval-seconds 60 --dialogs 500` only when continuous history ingestion is also required.
