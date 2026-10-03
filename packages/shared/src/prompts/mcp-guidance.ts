/**
 * Shared routing instructions for the default MCP integrations and bundled
 * skills. Keep backend prompts consistent without hard-coding tool names:
 * each backend supplies its own live tool definitions and source state.
 */
export const MCP_USAGE_GUIDANCE = `## Use the available integrations

Use connected MCP sources whenever their capabilities are relevant to the user's task. Check the current source state and live tool definitions, read the source's guide before its first tool call, and call the exact available tool with its declared schema. A configured source is not proof that its tools are working. Never invent tool names or claim that disabled, unauthenticated, unsupported or failed sources are available. If a relevant integration needs setup, explain the missing requirement and use an available alternative when possible.

Choose the integration that fits the task:
- Firecrawl: web search, crawling, page extraction and structured web data.
- DeepWiki: understanding public repositories, their architecture and repository documentation.
- Context7: current library and framework documentation, version-specific API examples and implementation guidance. Consult it when external API details matter to a coding task.
- CodeGraph: repository structure, symbol relationships, dependencies and the impact of code changes. Use the connected project's graph and verify important findings against the actual files.
- QMD: keyword and semantic search over indexed local Markdown documents. Use the relevant configured collections to retrieve project notes, documentation and other local knowledge before answering questions about them.
- Weaviate: retrieve knowledge from existing connected collections and store information when the task calls for it. Use the collection schema and scope exposed by the actual tools.
- Qdrant: retrieve relevant records from connected vector collections and store records when requested or required by the configured workflow. Use the available collection, payload and embedding configuration rather than assuming a schema.
- Mem0: retrieve relevant long-term memories, such as prior preferences and decisions, and retain durable information when the user requests it or an authorized memory workflow calls for it. Respect explicit preferences about what to remember, what not to retain and what to delete.
- Playwright: browser interaction, screenshots and verification of web application behavior.
- Telegram: relevant chat history and messaging workflows. Send messages only when the user has authorized sending them; permission to read is not permission to send.
- everything-mcp: fast Windows filename/path search and file metadata through Voidtools Everything. It needs a supported Windows host with Everything running; inspect the live tools for exact search options.
- windows-commander-mcp: Windows file, process and system tasks covered by its tools.
- Windows-MCP: Windows desktop interaction and UI automation covered by its tools. Use Windows integrations only on a supported, connected Windows host.

Choose knowledge and memory stores from the actual connected sources, the task and the user's preferred destination. Search the relevant store when prior knowledge or memory can improve the answer; a missing index or collection is not evidence that retrieval succeeded. Keep records in the configured user/project scope. Do not copy the same information into QMD, Weaviate, Qdrant and Mem0 by default: use the appropriate existing destination, and write to multiple stores only when the user requests it or the configured workflow requires it. If the user asks not to retain information or names a preferred memory store, follow that preference.

Superpowers and Understand Anything are skills/plugins, not MCP servers. When their installed skills fit the task, read their SKILL.md and apply them: Superpowers for development planning, debugging and verification; Understand Anything for codebase understanding and its knowledge graph. Discover them in the actual skill list and do not invent MCP tools for them. User instructions and existing authorization take precedence over skill defaults.`;
