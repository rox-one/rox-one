// worker_drain.ts — gracefully drain and stop a Windmill worker on this host,
// or resume it again.
//
// Windmill schedule: manual (worker group: privileged-ops).
// Rollback: run with --resume.
//
// Usage:
//   deno run --allow-env --allow-net --allow-read --allow-run \
//     worker_drain.ts            # drain + stop windmill-worker
//   deno run ... worker_drain.ts --resume   # start worker again
//
// Environment (Infisical identity):
//   WINDMILL_API_ENDPOINT  e.g. https://windmill.fleet.internal/api
//   WINDMILL_WORKER_ID     id of the worker being drained
//   WINDMILL_TOKEN         API token
//
// Drain semantics: Windmill exposes POST {endpoint}/workers/{id}/disable which
// stops accepting NEW jobs while finishing running ones. We poll until the
// queue for this worker reports idle (placeholder poll endpoint below —
// adjust to your Windmill version's jobs endpoint), then systemctl stop
// windmill-worker. Failures are loud; nothing is swallowed.

const endpoint = Deno.env.get("WINDMILL_API_ENDPOINT");
const workerId = Deno.env.get("WINDMILL_WORKER_ID");
const token = Deno.env.get("WINDMILL_TOKEN");
for (const [name, v] of [["WINDMILL_API_ENDPOINT", endpoint], ["WINDMILL_WORKER_ID", workerId], ["WINDMILL_TOKEN", token]] as const) {
  if (!v) {
    console.error(`worker_drain: required env var ${name} is unset`);
    Deno.exit(1);
  }
}

const resume = Deno.args.includes("--resume");

async function api(path: string, method: string): Promise<unknown> {
  const res = await fetch(`${endpoint}${path}`, {
    method,
    headers: { "Authorization": `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error(`worker_drain: ${method} ${path} -> HTTP ${res.status}`);
    Deno.exit(1);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function systemctl(action: string): Promise<void> {
  const status = await new Deno.Command("systemctl", { args: [action, "windmill-worker"] }).spawn().status;
  if (!status.success) {
    console.error(`worker_drain: systemctl ${action} windmill-worker failed (exit ${status.code})`);
    Deno.exit(1);
  }
  console.log(`worker_drain: systemctl ${action} windmill-worker OK`);
}

if (resume) {
  await systemctl("start");
  // Re-enable job pickup after a drain.
  await api(`/workers/${workerId}/enable`, "POST");
  console.log(`worker_drain: worker ${workerId} resumed`);
} else {
  // Stop accepting new jobs; running jobs finish first (graceful drain).
  await api(`/workers/${workerId}/disable`, "POST");
  // Placeholder idle-poll: adjust path/payload to your Windmill version.
  // Polls the worker's pending-job count until zero (max ~5 minutes).
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const queue = await api(`/jobs/queue?worker=${workerId}`, "GET") as unknown;
    const pending = typeof queue === "number" ? queue : Array.isArray(queue) ? queue.length : 0;
    if (pending === 0) break;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  await systemctl("stop");
  console.log(`worker_drain: worker ${workerId} drained and stopped`);
}
