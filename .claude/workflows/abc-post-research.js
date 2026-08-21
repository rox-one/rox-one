// meta must be a pure literal first statement
const meta = {
  name: "abc-post-research",
  description: "A+B+C gated program: evidence first, no Stage C mutation without APPLY",
};

async function run() {
  log("A+B+C: parallel evidence, sequential Hermes gates");
  const evidence = await parallel(
    () => agent({
      prompt: "Read-only A0 live preflight. No hermes config set. No APPLY. Write docs/security/2026-08-13-a0-live-preflight.md. FAIL CLOSED if target ambiguous.",
    }),
    () => agent({
      prompt: "Write Gate 0 contract or BLOCK at docs/security/external-access-deployment-contract.md. No invented datastore.",
    }),
    () => agent({
      prompt: "Architecture HTML to TMPDIR covering paths.ts, migrateNotes, source-index, credentials. Glossary: module interface seam depth.",
    }),
    () => agent({
      prompt: "Program C docs only: branding, remotes, maturity, Notes/SiYuan still-blocked. No merge, no Notes code.",
    }),
  );
  log("evidence lanes done");
  // Hermes A1-I0 are NOT in this workflow. They require exact APPLY then named gates.
  return { evidence, next: "АПPLY HMA-20260809-A1" };
}

await run();
