# 15 — Register OMP on the backend factory

**What to build:** The factory that seeds `rox-kimi` also lists `omp` as an available provider. Host-runtime init runs for OMP the same way it runs for anthropic/pi. A caller that trusts `getAvailableProviders()` can see the default backend.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `getAvailableProviders()` includes `'omp'`
- [ ] `isProviderAvailable('omp')` is true
- [ ] `initializeBackendHostRuntime` visits the OMP driver
- [ ] A registry test fails if `AgentProvider` and the returned list diverge
