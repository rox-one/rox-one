# Roadmap recovery execution plan

| Task | Owner | Dependencies | Paths | Verification | State |
|---|---|---|---|---|---|
| Recover orphan feature / bind source | repo_audit | Parent confirmed active ownership boundaries | isolated worktree only | original branch clean; baseline40391c08 | complete |
| Reproduce stale save / failed backup | repo_audit | baseline | projects/__tests__/roadmap-storage-recovery.test.ts | six actual filesystem red failures | complete |
| Compare/write fence and backup refusal | repo_audit | failing regressions | roadmap-storage.ts,roadmap.ts,index.ts | stale revision, unchanged bytes, two processes, exclusive lock, backup failure, reload | verified |
| Acknowledged renderer autosave | repo_audit | read/save token contract | roadmap.ts,ProjectInfoPage.tsx | actual extracted hook callbacks; ordered ACK, retained edit, failure, scope cleanup | verified |
| Independent edge repairs | terminal_history reviewer + repo_audit | initial implementation | roadmap-storage.ts,ProjectInfoPage.tsx,recovery/caller tests | escaped projects symlink and failed-read Saving state reproduced red then green | independently verified |
| Review / verification / local delivery | root + terminal_history independent reviewer + repo_audit | fixes | docs/roadmap-recovery.md, local commit | 28 pinned Bun tests/120 assertions, baseline type diagnostics comparison, independent review, receipt; honest draft status | locally verified; commit receipt at parent handoff |

Parent retains remote branch/PR delivery, main integration, native UI ownership and issue acceptance. No push, PR or merge occurs before root review. Existing compound and September source changes are preserved and excluded from this worktree.
