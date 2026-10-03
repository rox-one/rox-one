#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { loadEnvironment } from "../app/environment.js";
import {
  getPublicMcpToolContractDefinitions,
  getToolContractDefinitions,
} from "../contracts/tool-contracts.js";
import { executeLocalToolCall } from "../core/tool-dispatch.js";

loadEnvironment();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function redactSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveFields);
  }
  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "sessionPath")
      .map(([key, child]) => [key, redactSensitiveFields(child)]),
  );
}

function contentFor(payload: unknown) {
  return [
    {
      type: "text" as const,
      text: JSON.stringify(payload, null, 2) ?? "null",
    },
  ];
}

function toolError(payload: unknown): CallToolResult {
  return {
    content: contentFor(payload),
    isError: true,
  };
}

function isFailedPayload(payload: unknown) {
  return isRecord(payload) && payload.ok === false;
}

function createServer() {
  const internalTools = getToolContractDefinitions();
  const publicTools = getPublicMcpToolContractDefinitions();
  const server = new Server(
    {
      name: "tgchats-local",
      title: "tgchats Local",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      instructions:
        "Prefer read-first workflows. Use explicit mutation tools only when requested.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: publicTools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: tool.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const toolIndex = publicTools.findIndex(
        (tool) => tool.name === request.params.name,
      );
      if (toolIndex === -1) {
        throw new Error(`Unknown tool: ${request.params.name}`);
      }
      const payload = redactSensitiveFields(
        await executeLocalToolCall(
          internalTools[toolIndex].name,
          request.params.arguments || {},
        ),
      );

      if (isFailedPayload(payload)) {
        return toolError(payload);
      }

      return {
        content: contentFor(payload),
        structuredContent: isRecord(payload) ? payload : { result: payload },
      } satisfies CallToolResult;
    } catch (error) {
      return toolError({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  transport.onerror = (error) => {
    console.error("MCP transport error:", error);
  };
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start tgchats local MCP:", error);
  process.exitCode = 1;
});
