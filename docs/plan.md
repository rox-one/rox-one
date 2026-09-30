# UTB reference strictness recovery plan

| Task | Owner | Depends on | Verification | State |
|---|---|---|---|---|
| Bind exact published head and isolated checkout | repo_audit | Root assignment | a428eb42, detached baseline, original branch unchanged | Complete |
| Rerun declared unit/type/export gates | repo_audit | Pinned binaries; borrowed frozen external dependencies | Bun54, Node22 54; actual canonical closure; additive export; baseline comparison | Complete / baseline downstream gates retained |
| Reproduce hidden property and getter defects | repo_audit | Published codec | Actual published API: 54 existing pass, 18 adverse failures | Complete |
| Repair inert own-property validation | repo_audit | Adverse RED | Two production helpers and one adverse test file | Complete |
| Verify positive, negative and baseline controls | repo_audit | Repair | Bun/Node22 each72/0; canonical closure/export0; old codec mutation58/14; full core13 unchanged | Complete / global failures retained |
| Independent review | terminal_history | Frozen source and receipts | Spec+Standards on exact three-file diff; independent Bun72/0 | Complete; bounded source accepted |
| Local commit preparation | repo_audit | Independent acceptance | Exact source hashes, scoped documents and hashed receipts | Ready for authorized commit |
| Stacked draft delivery | root / repo_audit | Root exact revision review | Correct base branch, remote head/readback; no close/merge | Pending |

Shared registrations, Base owners, editor/native/provider work stay with their active owners. UTB-02 requires canonical persistence/query/ACL and host-CAS dependencies; this repair supplies only the reference contract.
