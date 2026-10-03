import { describe, expect, it } from "vitest";
import { CHIHO_CLOUD_TOOL_CONTRACTS } from "./chiho-cloud-contracts.js";
import { getToolContractDefinitions, getPortableMcpToolName } from "./tool-contracts.js";
import exported from "../../docs/chiho-cloud-tool-contracts.json" with { type: "json" };
describe("hosted Chiho team contracts", () => {
  it("exports the canonical catalogue separately from local tools", () => {
    expect(exported).toEqual(CHIHO_CLOUD_TOOL_CONTRACTS);
    const localNames = getToolContractDefinitions().map((tool) => tool.name);
    const names = CHIHO_CLOUD_TOOL_CONTRACTS.map((tool) => getPortableMcpToolName(tool.name));
    expect(new Set(names).size).toBe(names.length);
    for (const tool of CHIHO_CLOUD_TOOL_CONTRACTS) expect(localNames).not.toContain(tool.name);
  });
  it("marks external invitations and destructive membership changes accurately", () => {
    expect(CHIHO_CLOUD_TOOL_CONTRACTS.find((tool) => tool.name === "team.invite")?.annotations.openWorldHint).toBe(true);
    for (const name of ["team.delete", "team.member.remove", "team.leave"]) {
      const tool = CHIHO_CLOUD_TOOL_CONTRACTS.find((tool) => tool.name === name)!;
      expect(tool.annotations.destructiveHint).toBe(true);
      expect(tool.inputSchema.required).toContain("confirmed");
    }
  });
});
