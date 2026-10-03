import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHIHO_CLOUD_TOOL_CONTRACTS } from "./chiho-cloud-contracts.js";
import {
  getPublicMcpToolContractDefinitions,
  TOOL_CONTRACT_DEFINITIONS,
} from "./tool-contracts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputPath = path.resolve(__dirname, "../../docs/tool-contracts.json");
const publicOutputPath = path.resolve(
  __dirname,
  "../../docs/public-mcp-tool-contracts.json",
);

await Promise.all([
  fs.writeFile(path.resolve(__dirname, "../../docs/chiho-cloud-tool-contracts.json"), `${JSON.stringify(CHIHO_CLOUD_TOOL_CONTRACTS, null, 2)}\n`, "utf8"),
  fs.writeFile(
    outputPath,
    `${JSON.stringify(TOOL_CONTRACT_DEFINITIONS, null, 2)}\n`,
    "utf8",
  ),
  fs.writeFile(
    publicOutputPath,
    `${JSON.stringify(getPublicMcpToolContractDefinitions(), null, 2)}\n`,
    "utf8",
  ),
]);

console.log(`Wrote ${outputPath}`);
console.log(`Wrote ${publicOutputPath}`);
