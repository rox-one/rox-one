# Ticket 16 — next-program hygiene leftovers

Date: 2026-08-13  
Branch: `rox/next-program-t16-hygiene-7c33`

Spec stories that tickets 04/08 left on the floor:

| Story / inventory | Binding | Result |
|---|---|---|
| 16 / 9.4 Discord in Docker | UI offers Discord → image must ship the worker | `Dockerfile.server` copies, builds, and `ENV`s `CRAFT_MESSAGING_DISCORD_WORKER` (same contract as WhatsApp; packaged server already did this) |
| 23 / 8.7 pdfjs `?url` | bun tests green or skipped with a ticket | bun preload mocks `pdfjs-dist/build/pdf.worker.min.mjs?url` to a string default |
| 04 leftover | `bun run tsc --noEmit` in shared | `thinkingLevel` narrowed before the membership check |
| 08 leftover | dead `workspaces` exclusions | `"!apps/online-docs"` / `"!apps/marketing"` removed |

Not in this ticket: live `ROX_API_KEY` turn (13), G2/legal (14), appId, remote deletes, production CF/R2.
