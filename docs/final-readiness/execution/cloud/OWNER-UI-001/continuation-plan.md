# UI-001 continuation plan and ownership

1. Root integrates typed unavailable views, exact pending request replay, workspace-scoped session mounting and history/reload tests. Owns shared routing/types, NavigationContext, panel dispatch, locales and documentation.
2. source_review repairs selected leaf races in ProjectInfoPage, CloudRunSurfacePage and TerminalSurfacePage, with actual callback/deferred tests. Additional leaf paths require a non-overlapping declaration.
3. regression_scout repairs test process/executor discovery, meeting Electron portability and the obsolete terminal dispatch test. Owns scripts/test-all.ts, package.json scripts.test only and declared harness/tests.
4. platform_scout adds dev protocol-registration opt-out and tests, and supplies an isolated native launcher. Owns main/index.ts and declared new native tests.
5. Root independently checks reports, integrates current remote main using ordinary merge, runs scoped tests plus relevant package/CI/build/server and repository gates on the candidate, and reviews the final diff.
6. Root creates/attaches a focused PR, obtains actual hosted check results, merges the verified head into main and reads back merged SHA/parents/source. Preserve all prior failures and exact external acceptance prerequisites.

Dependencies: source repairs and runner/platform preparation are independent. Final verification follows all source changes and any upstream merge. Git delivery follows successful relevant gates and source review. FullDoD remains false until every original platform acceptance is observed.
