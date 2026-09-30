# CI recovery execution plan

| Task | Owner | Dependencies | Verification | State |
|---|---|---|---|---|
| Bind isolated baseline | cloud_recovery | Parent allocation | Absolute root, branch and clean base `f63294ba` | Complete |
| Verify hosted runner and billing | cloud_recovery | Current primary docs; public repo readback | Supported `macos-15`; public standard runner billing; queued current jobs | Complete |
| Repair runner and version configuration | cloud_recovery | Evidence above | Both YAML files parse; `validate:ci` and job identities retained; frozen Bun1.3.14 | Complete |
| Replace placeholder with built runtime proof | cloud_recovery | Own dependencies and three real builds | Built lifecycle2/2; related source/WebUI/transport23/23; missing-artifact negative controls fail | Complete |
| Typecheck and baseline comparison | cloud_recovery | Installed TypeScript5.9.3 | Same eight existing server diagnostics; no new test diagnostics; plain baseline `validate:ci` stops on13known core errors | Complete |
| Root review and integration | root | Local receipt commit; core/bridge/typecheck fixes | Review source and docs; merge documentation sections; rerun integrated built gate | Pending |
| Hosted delivery receipt | root | Authorized push/PR after review | Actual hosted run starts and all required checks finish; no placeholder status | Pending |

The workflow proposal and local runtime proof are complete. Remote execution and full integrated validation remain separate delivery gates. No remote mutation occurred in this worktree.
