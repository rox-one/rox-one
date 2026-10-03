# Execution plan and ownership

Lead/scheduler owns integration branch, spec digest, DAG and leases. Worker owns one WP paths and proof folder. Native/provider evaluators own their lane receipts. Reviewer owns independent acceptance. No simultaneous changes of shared platform-contract.ts/nav registry/transport/bun.lock/module command tables.

1. Validate read-only planning pack; preflight machine; inspect existing implementation before carrying out old gaps. No blind reimplementation if task already merged upstream.
2. Bootstrap WP52 and root identity WP01 according to DAG and ownership conflicts. Receipt definitions/ports are independent of future entity FK in WP01.
3. Launch only ready nodes, merge reviewed dependency commits, update inputSha. Run reusable primitives plus vertical feature gates, not database-only milestones.
4. Cloud domain/renderer work can run while native/provider evaluator queue waits; successors remain blocked if prerequisite required lane unresolved.
5. Integrate Page/Chat→Task/Project, Mail→CRM, Calendar→Meeting, Calls/archive, account workflows. Full DAG in existing dependency-dag.json; source-only estimates do not promise dates.
6. WP41 integrated scenarios and WP47 disaster restore/release gate after corresponding features; WP48 origin/SBOM reviewed before literal ports and release.

Successor plan is computed from current receipts, not hardcoded sprint numbers. Cloud execution owner must bound spend/TTL/secrets and reserve test tenant. User asked to prepare future launch; no cloud allocation made here.
