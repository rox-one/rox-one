// fleet_inventory_refresh.ts — probe every host from the settings hosts list
// over SSH (BatchMode) and write a JSON snapshot to the path given as argument.
//
// Windmill schedule: every 6 hours (worker group: linux-small).
// Rollback: disable the schedule in Windmill UI.
//
// Usage: deno run --allow-read --allow-write --allow-run --allow-env \
//          fleet_inventory_refresh.ts <settings.yml> <output.json>
//
// Per-host failure (ssh nonzero / timeout) is RECORDED in the snapshot, never
// fatal for other hosts. Only bad arguments or an unwritable output path fail
// the whole step.

import { parse } from "jsr:@std/yaml@1";

interface HostEntry {
  name: string;
  address: string;
  user: string;
}
interface Settings {
  hosts: HostEntry[];
}
export interface ProbeResult {
  host: string;
  address: string;
  reachable: boolean;
  checked_at: string;
  error?: string;
}

function fail(msg: string): never {
  console.error(`fleet_inventory_refresh: ${msg}`);
  Deno.exit(1);
}

const [settingsPath, outputPath] = Deno.args;
if (!settingsPath || !outputPath) {
  fail("usage: fleet_inventory_refresh.ts <settings.yml> <output.json>");
}

let settings: Settings;
try {
  settings = parse(await Deno.readTextFile(settingsPath)) as Settings;
} catch (e) {
  fail(`cannot read/parse settings ${settingsPath}: ${e}`);
}
if (!Array.isArray(settings.hosts) || settings.hosts.length === 0) {
  fail(`settings ${settingsPath} has no hosts list`);
}

async function probe(host: HostEntry): Promise<ProbeResult> {
  const target = `${host.user}@${host.address}`;
  const cmd = new Deno.Command("ssh", {
    args: [
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=8",
      "-o", "StrictHostKeyChecking=accept-new",
      target,
      "true",
    ],
    stdout: "null",
    stderr: "piped",
  });
  const started = new Date().toISOString();
  try {
    const { promise: timeoutP, resolve: timeoutResolve } = Promise.withResolvers<null>();
    setTimeout(() => timeoutResolve(null), 15_000);
    const status = await Promise.race([cmd.spawn().status, timeoutP]);
    if (status === null) {
      return { host: host.name, address: host.address, reachable: false, checked_at: started, error: "probe timed out after 15s" };
    }
    if (!status.success) {
      return { host: host.name, address: host.address, reachable: false, checked_at: started, error: `ssh exited ${status.code}` };
    }
    return { host: host.name, address: host.address, reachable: true, checked_at: started };
  } catch (e) {
    return { host: host.name, address: host.address, reachable: false, checked_at: started, error: String(e) };
  }
}

const results = await Promise.all(settings.hosts.map(probe));

const snapshot = {
  generated_at: new Date().toISOString(),
  total: results.length,
  reachable: results.filter((r) => r.reachable).length,
  unreachable: results.filter((r) => !r.reachable).map((r) => r.host),
  probes: results,
};

await Deno.writeTextFile(outputPath, JSON.stringify(snapshot, null, 2) + "\n");
console.log(
  `inventory snapshot written to ${outputPath}: ` +
    `${snapshot.reachable}/${snapshot.total} reachable` +
    (snapshot.unreachable.length ? ` (unreachable: ${snapshot.unreachable.join(", ")})` : ""),
);
