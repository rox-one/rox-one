# Runtime delivery task graph

| Task | Owner | Owned files | Dependencies | Verification | State |
|---|---|---|---|---|---|
| Restore/branch lifecycle and mandatory magic triggers | history agent | omp-agent.ts, related OMP tests/helpers | protocol notes, current CLI | failing regressions then real RPC restart/fork/magic probes | active |
| Requested skill inventory, vendoring, runtime discovery | skills agent | resources/skills, skills modules/tests, omp-first-run.ts | canonical upstream research | clean temporary home sync and real OMP discovery | active |
| Context path/migration and branding audit | context agent | context-docs, config env/migration tests; audit docs | current config/storage | legacy/ROX isolation and preservation regressions | active |
| Force OMP routing and integrate namespace migration | lead | backend routing, SessionManager, remaining branding/package/build surfaces | owned-file handoffs | existing connection/session tests and typecheck | active |
| Independent review, release and native install | lead + available reviewer | integrated checkout/release automation | all preceding | remote validate/package, manifest readback, native app UI | pending |

Checkpoints and discovered migration exceptions must be recorded in this file. No collaborator writes another task's owned files without a handoff.
