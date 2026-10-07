# Cloud runs — default Daytona runtime bundle

Provider: **Daytona** (`packages/cloud-runner`, `DaytonaProvider`).

## Image / snapshot contents (sign-off target)

1. **Base:** Ubuntu LTS (Daytona snapshot).
2. **Toolchain:** `bun`, Node 20, `uv` + Python 3.12, `git`, `curl`, `jq`, `ripgrep`.
3. **Agent:** OMP / pi-coding-agent + minimal bundled skills.
4. **MCP (stdio):** Exa, Firecrawl, Brave, Langfuse — API keys injected at runtime from server entitlement DB, not baked into image.
5. **Env in sandbox:** per-user `ROX_API_KEY` ref, operator `DAYTONA_API_KEY` in `~/rox/cloud-runs.env` (0600).
6. **Bootstrap order:** sync workspace → seed MCP configs → `omp --mode rpc` health → cloud-run subtasks.

## Operator setup (desktop)

```bash
mkdir -p ~/rox
printf 'DAYTONA_API_KEY=...\n' >> ~/rox/cloud-runs.env
chmod 600 ~/rox/cloud-runs.env
```

Settings → **Облачные запуски** → grant config read → **Загрузить конфигурацию** → provider **daytona**.
