import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function parseYaml(path: string): unknown {
  return Bun.YAML.parse(readFileSync(path, "utf8"));
}

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  return value as Record<string, unknown>;
}

describe("ROX fleet control plane", () => {
  test("site.yml roles exist and match fail-closed enablement keys", () => {
    const docs = parseYaml(join(ROOT, "playbooks/site.yml"));
    const site = asRecord(Array.isArray(docs) ? docs[0] : docs);
    const roles = (site.roles as Array<{ role: string }>) ?? [];
    const roleNames = roles.map((entry) => entry.role);
    expect(roleNames).toEqual([
      "base",
      "users",
      "ssh",
      "firewall",
      "tailscale",
      "docker",
      "netdata",
      "infisical-agent",
      "coolify-target",
      "windmill-worker",
      "agent-runtime",
      "backups",
    ]);
    for (const name of roleNames) {
      expect(statSync(join(ROOT, "roles", name, "tasks/main.yml")).isFile()).toBe(true);
    }

    const groupVars = asRecord(parseYaml(join(ROOT, "inventory/group_vars/all/main.yml")));
    const enabled = asRecord(groupVars.fleet_role_enabled);
    expect(Object.values(enabled).every((flag) => flag === false)).toBe(true);
    expect(Object.keys(enabled).sort()).toEqual(
      roleNames.map((name) => name.replaceAll("-", "_")).sort(),
    );
  });

  test("example inventory uses TEST-NET-1 and required groups", () => {
    const inventory = asRecord(parseYaml(join(ROOT, "inventory/hosts.yml")));
    const all = asRecord(inventory.all);
    const children = asRecord(all.children);
    for (const group of [
      "linux",
      "apple",
      "control_plane",
      "automation_control",
      "observability_control",
      "netbird_retire",
      "coolify_targets",
    ]) {
      expect(children).toHaveProperty(group);
    }

    const hostsFile = readFileSync(join(ROOT, "inventory/hosts.yml"), "utf8");
    const ips = hostsFile.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
    expect(ips.length).toBeGreaterThan(0);
    expect(ips.every((ip) => ip.startsWith("192.0.2."))).toBe(true);
  });

  test("second YAML parse of playbooks and inventory is identical (idempotent)", () => {
    const paths = [
      "playbooks/site.yml",
      "playbooks/discovery.yml",
      "inventory/hosts.yml",
      "inventory/group_vars/all/main.yml",
      "inventory/group_vars/all/versions.yml",
      "windmill/settings.example.yml",
    ];
    for (const rel of paths) {
      const first = parseYaml(join(ROOT, rel));
      const second = Bun.YAML.parse(Bun.YAML.stringify(first));
      expect(second).toEqual(first);
    }
  });

  test("tree does not embed live secrets, auth keys, or non-example public IPs", () => {
    const forbidden = [
      /tskey-/,
      /ghp_[A-Za-z0-9]+/,
      /AKIA[0-9A-Z]{16}/,
      /BEGIN (OPENSSH|RSA) PRIVATE KEY/,
      /6aa9e26f-664e-4c3c-9bc9-07e00a01904a/,
      /0bbb30b5-e836-4c78-80b8-8b32380d8cb7/,
      /tb-mac\.blenny-gar\.ts\.net/,
      /\b100\.(?:89|116|85|126)\.\d+\.\d+\b/,
    ];
    for (const file of walk(ROOT)) {
      if (file.endsWith(".test.ts") || file.endsWith(".pyc")) continue;
      const rel = relative(ROOT, file);
      const text = readFileSync(file, "utf8");
      for (const rx of forbidden) {
        expect(rx.test(text), `${rel} matched ${rx}`).toBe(false);
      }
    }
  });

  test("ansible-playbook syntax-check is clean for control-plane playbooks", () => {
    for (const playbook of [
      "playbooks/site.yml",
      "playbooks/discovery.yml",
      "playbooks/observability-control.yml",
      "playbooks/windmill-control.yml",
      "playbooks/netbird-retire.yml",
      "playbooks/bootstrap-coolify-deploy-key.yml",
    ]) {
      const result = spawnSync("ansible-playbook", ["--syntax-check", playbook], {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, ANSIBLE_GATHERING: "explicit", ANSIBLE_RETRY_FILES_ENABLED: "False" },
      });
      expect(result.status, `${playbook}: ${result.stderr || result.stdout}`).toBe(0);
    }
  }, 30_000);

  test("windmill python steps compile and bash helpers fail closed without env", () => {
    const py = spawnSync("python3", ["-m", "py_compile", ...[
      "windmill/backup_trigger.py",
      "windmill/disk_cleanup.py",
      "windmill/failed_unit_remediation.py",
      "windmill/restore_test_weekly.py",
    ].map((rel) => join(ROOT, rel))], { encoding: "utf8" });
    expect(py.status, py.stderr).toBe(0);

    for (const script of readdirSync(join(ROOT, "scripts"))) {
      if (!script.endsWith(".sh")) continue;
      const syntax = spawnSync("bash", ["-n", join(ROOT, "scripts", script)], { encoding: "utf8" });
      expect(syntax.status, syntax.stderr).toBe(0);
    }

    const missing = spawnSync("bash", [join(ROOT, "scripts/bootstrap-infisical-identities.sh")], {
      encoding: "utf8",
      env: { ...process.env, INFISICAL_ORG_ID: "", INFISICAL_PROJECT_ID: "", FLEET_INFISICAL_NODES: "" },
    });
    expect(missing.status).not.toBe(0);
  });
});
