// cert_check.ts — verify TLS certificate expiry for every domain in the
// input list. Any certificate expiring in <= 14 days raises (nonzero exit).
//
// Windmill schedule: daily (worker group: linux-small).
// Rollback: disable the schedule.
//
// Usage: deno run --allow-read --allow-net cert_check.ts <domains.json>
//   domains.json: JSON array of hostnames, e.g. ["windmill.fleet.internal"]

const MIN_VALID_DAYS = 14;
const CONNECT_TIMEOUT_MS = 10_000;

function fail(msg: string): never {
  console.error(`cert_check: ${msg}`);
  Deno.exit(1);
}

const domainsPath = Deno.args[0];
if (!domainsPath) fail("usage: cert_check.ts <domains.json>");

let domains: unknown;
try {
  domains = JSON.parse(await Deno.readTextFile(domainsPath));
} catch (e) {
  fail(`cannot read/parse ${domainsPath}: ${e}`);
}
if (!Array.isArray(domains) || domains.some((d) => typeof d !== "string")) {
  fail(`${domainsPath} must be a JSON array of domain strings`);
}

async function daysUntilExpiry(domain: string): Promise<{ days: number; notAfter: string }> {
  const sclient = new Deno.Command("sh", {
    args: [
      "-c",
      `openssl s_client -servername ${domain} -connect ${domain}:443 </dev/null 2>/dev/null | ` +
        `openssl x509 -noout -enddate`,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const res = await sclient.output();
  if (!res.success) throw new Error(`openssl handshake failed for ${domain}`);
  const match = new TextDecoder().decode(res.stdout).match(/notAfter=(.+)/);
  if (!match) throw new Error(`could not parse certificate end date for ${domain}`);
  const notAfter = new Date(match[1].trim());
  return {
    days: Math.floor((notAfter.getTime() - Date.now()) / 86_400_000),
    notAfter: notAfter.toISOString(),
  };
}

let failures = 0;
for (const domain of domains as string[]) {
  try {
    const { promise: timeoutP, reject } = Promise.withResolvers<never>();
    setTimeout(() => reject(new Error(`TLS connect timed out after ${CONNECT_TIMEOUT_MS}ms`)), CONNECT_TIMEOUT_MS);
    const result = await Promise.race([daysUntilExpiry(domain), timeoutP]);
    if (result.days > MIN_VALID_DAYS) {
      console.log(`OK      ${domain}: expires in ${result.days} days (${result.notAfter})`);
    } else {
      console.error(`EXPIRING ${domain}: expires in ${result.days} days (${result.notAfter}) — below ${MIN_VALID_DAYS}-day threshold`);
      failures++;
    }
  } catch (e) {
    console.error(`FAILED  ${domain}: ${e instanceof Error ? e.message : e}`);
    failures++;
  }
}

if (failures > 0) {
  Deno.exit(1); // fail loudly: at least one certificate is expiring or unreachable
}
console.log(`cert_check: all ${domains.length} domains above the ${MIN_VALID_DAYS}-day expiry threshold`);
