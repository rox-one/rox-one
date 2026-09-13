// update_report.ts — weekly markdown report of pending updates per host.
//
// Windmill schedule: weekly Monday 08:00 (worker group: linux-small).
// Rollback: disable the schedule.
//
// Usage: deno run --allow-read --allow-net --allow-run \
//          update_report.ts <settings.yml> [output.md]
//   Reads the settings hosts list; per host runs over SSH (BatchMode):
//     apt list --upgradable 2>/dev/null | grep -c upgradable   (count)
//     test -f /var/run/reboot-required && echo yes || echo no
// Output: markdown table written to stdout and (if given) output.md.
// Hosts are probed independently; unreachable hosts get a row with error text,
// but any ssh invocation that itself cannot be spawned fails loudly.

import { parse } from "jsr:@std/yaml@1";

interface HostEntry {
  name: string;
  address: string;
  user: string;
}
interface Settings {
  hosts: HostEntry[];
}

function fail(msg: string): never {
  console.error(`update_report: ${msg}`);
  Deno.exit(1);
}

const [settingsPath, outputPath] = Deno.args;
if (!settingsPath) fail("usage: update_report.ts <settings.yml> [output.md]");

let settings: Settings;
try {
  settings = parse(await Deno.readTextFile(settingsPath)) as Settings;
} catch (e) {
  fail(`cannot read/parse settings ${settingsPath}: ${e}`);
}

async function ssh(target: string, command: string): Promise<{ ok: boolean; out: string }> {
  const cmd = new Deno.Command("ssh", {
    args: ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "StrictHostKeyChecking=accept-new", target, command],
    stdout: "piped",
    stderr: "piped",
  });
  const res = await cmd.output();
  return {
    ok: res.success,
    out: new TextDecoder().decode(res.stdout).trim() || new TextDecoder().decode(res.stderr).trim(),
  };
}

async function hostRow(host: HostEntry): Promise<[string, string, string]> {
  const target = `${host.user}@${host.address}`;
  const count = await ssh(target, "apt list --upgradable 2>/dev/null | grep -c '^\\S*/' ");
  const reboot = await ssh(target, "test -f /var/run/reboot-required && echo yes || echo no");
  if (!count.ok) {
    return [host.name, "unreachable", reboot.ok && reboot.out === "yes" ? "yes" : "unknown"];
  }
  return [host.name, String(Math.max(0, parseInt(count.out, 10) || 0)), reboot.out === "yes" ? "yes" : "no"];
}

const rows = await Promise.all(settings.hosts.map(hostRow));

const lines = [
  `# Fleet update report — ${new Date().toISOString()}`,
  "",
  "| host | apt packages upgradable | reboot required |",
  "|------|------------------------:|-----------------|",
  ...rows.map(([h, c, r]) => `| ${h} | ${c} | ${r} |`),
];
const report = lines.join("\n") + "\n";
console.log(report);
if (outputPath) {
  await Deno.writeTextFile(outputPath, report);
  console.log(`update_report: written to ${outputPath}`);
}
