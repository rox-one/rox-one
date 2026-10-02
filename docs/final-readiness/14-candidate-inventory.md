# [CANDIDATE-INVENTORY] Assembled branch architecture and dependencies

Pinned candidate: `de805e0dc7103b49d4c7f0a092d88c8b4222367a`, PR1322. This is an unmerged source candidate, not a replacement for the main-only inventory or a verified production deployment. Every declared dependency below is read from this exact Git tree.

## [CANDIDATE-WORKSPACES] All 18 workspaces

| Workspace | Manifest | Tracked source paths |
| --- | --- | ---: |
| `apps/cli` | [manifest](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/cli/package.json#L1) | 10 |
| `apps/cloud-gateway` | [manifest](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/cloud-gateway/package.json#L1) | 9 |
| `apps/electron` | [manifest](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/package.json#L1) | 2343 |
| `apps/viewer` | [manifest](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/viewer/package.json#L1) | 30 |
| `apps/webui` | [manifest](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/webui/package.json#L1) | 32 |
| `apps/workspace-service` | [manifest](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/workspace-service/package.json#L1) | 19 |
| `packages/cloud-runner` | [manifest](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/cloud-runner/package.json#L1) | 22 |
| `packages/core` | [manifest](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/core/package.json#L1) | 252 |
| `packages/messaging-discord-worker` | [manifest](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-discord-worker/package.json#L1) | 6 |
| `packages/messaging-gateway` | [manifest](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-gateway/package.json#L1) | 86 |
| `packages/messaging-whatsapp-worker` | [manifest](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-whatsapp-worker/package.json#L1) | 11 |
| `packages/pi-agent-server` | [manifest](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/pi-agent-server/package.json#L1) | 46 |
| `packages/server-core` | [manifest](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/package.json#L1) | 513 |
| `packages/server` | [manifest](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server/package.json#L1) | 7 |
| `packages/session-mcp-server` | [manifest](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/session-mcp-server/package.json#L1) | 3 |
| `packages/session-tools-core` | [manifest](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/session-tools-core/package.json#L1) | 78 |
| `packages/shared` | [manifest](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/package.json#L1) | 1114 |
| `packages/ui` | [manifest](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/ui/package.json#L1) | 216 |

## [CANDIDATE-ARCHITECTURE] Additional layers and changed contracts

- **Workspace service:** new `apps/workspace-service` Bun HTTP/WebSocket executable with build/typecheck/test/package scripts and SQL migrations; it is an additional deployable service, not proof that production storage/auth/deployment has been configured.
- **Authority and persistence:** server-side native authority/journal, Notes canonical writer and caller ACK boundary; account-replica encrypted durable outbox and Notes-focused collaboration synchronization; scheduler occurrence and agent budget durability.
- **Product surface:** Search and project roadmap/OKR, repository snapshots and AI context, native project projections, richer Notes editors/table/outline, Compound legal evidence and other work described in the surface reconciliation. September and Compound lineages must be preserved when integrating later fixes.
- **Provider/runtime:** additional OMP startup/model/transport, voice/privacy, code intelligence/repository connections and source-truth controls. Registered provider implementations and actual external account readiness remain separate.
- **Build and delivery:** browser shim/capability fences, subprocess/native staging controls, real standalone server lifecycle smoke and legal/SBOM tooling. Existing Docker/platform/release inconsistencies and omitted workspace gates remain listed in the platform review.

These statements are source observations. See [service reconciliation](11-service-reconciliation.md), [surface reconciliation](10-surface-reconciliation.md), [platform reconciliation](12-platform-reconciliation.md) and [executed candidate checks](15-candidate-verification.md) for exact code and limits.

## [CANDIDATE-DEP] craft-agent — [package.json](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/package.json#L1)

| Dependency | Constraint | Role |
| --- | --- | --- |
| `@anthropic-ai/claude-agent-sdk` | `0.3.258` | dependencies |
| `@anthropic-ai/sdk` | `^0.100.0` | dependencies |
| `@dnd-kit/dom` | `^0.4.0-beta-20260227032529` | dependencies |
| `@dnd-kit/helpers` | `^0.4.0-beta-20260227032529` | dependencies |
| `@earendil-works/pi-ai` | `0.85.1` | dependencies |
| `@earendil-works/pi-coding-agent` | `0.85.1` | dependencies |
| `@github/copilot-sdk` | `^0.1.23` | dependencies |
| `@modelcontextprotocol/sdk` | `^1.29.0` | dependencies |
| `@radix-ui/react-avatar` | `^1.1.11` | dependencies |
| `@radix-ui/react-collapsible` | `^1.1.12` | dependencies |
| `@radix-ui/react-dropdown-menu` | `^2.1.16` | dependencies |
| `@radix-ui/react-scroll-area` | `^1.2.10` | dependencies |
| `@radix-ui/react-select` | `^2.2.6` | dependencies |
| `@radix-ui/react-separator` | `^1.1.8` | dependencies |
| `@radix-ui/react-slot` | `^1.2.4` | dependencies |
| `@radix-ui/react-tabs` | `^1.1.13` | dependencies |
| `@radix-ui/react-tooltip` | `^1.2.8` | dependencies |
| `@sentry/electron` | `^7.7.0` | dependencies |
| `@sentry/react` | `^10.36.0` | dependencies |
| `@shikijs/cli` | `^3.19.0` | dependencies |
| `@tailwindcss/typography` | `^0.5.19` | dependencies |
| `@tiptap/extension-bubble-menu` | `^3.20.0` | dependencies |
| `@tiptap/extension-file-handler` | `^3.20.0` | dependencies |
| `@tiptap/extension-image` | `^3.20.0` | dependencies |
| `@tiptap/extension-mathematics` | `^3.20.0` | dependencies |
| `@tiptap/extension-placeholder` | `^3.20.0` | dependencies |
| `@tiptap/extension-task-item` | `^3.20.0` | dependencies |
| `@tiptap/extension-task-list` | `^3.20.0` | dependencies |
| `@tiptap/markdown` | `^3.20.0` | dependencies |
| `@tiptap/react` | `^3.20.0` | dependencies |
| `@tiptap/starter-kit` | `^3.20.0` | dependencies |
| `@tiptap/suggestion` | `^3.20.0` | dependencies |
| `@vscode/ripgrep` | `^1.17.1` | dependencies |
| `beautiful-mermaid` | `^1.1.3` | dependencies |
| `class-variance-authority` | `^0.7.1` | dependencies |
| `clsx` | `^2.1.1` | dependencies |
| `date-fns` | `^4.1.0` | dependencies |
| `gray-matter` | `^4.0.3` | dependencies |
| `jotai` | `^2.16.0` | dependencies |
| `js-yaml` | `^4.1.1` | dependencies |
| `katex` | `^0.16.33` | dependencies |
| `linkify-it` | `^5.0.0` | dependencies |
| `lucide-react` | `^0.561.0` | dependencies |
| `marked` | `^17.0.1` | dependencies |
| `markitdown-js` | `^0.0.14` | dependencies |
| `open` | `^11.0.0` | dependencies |
| `prosemirror-highlight` | `^0.15.0` | dependencies |
| `react` | `^18.3.1` | dependencies |
| `react-dom` | `^18.3.1` | dependencies |
| `react-markdown` | `^10.1.0` | dependencies |
| `react-resizable-panels` | `^3.0.6` | dependencies |
| `rehype-katex` | `^7.0.1` | dependencies |
| `rehype-raw` | `^7.0.0` | dependencies |
| `remark-gfm` | `^4.0.1` | dependencies |
| `remark-math` | `^6.0.0` | dependencies |
| `semver` | `^7.7.3` | dependencies |
| `shiki` | `^3.19.0` | dependencies |
| `tailwind-merge` | `^3.4.0` | dependencies |
| `tiptap-extension-code-block-shiki` | `^1.0.0` | dependencies |
| `tiptap-markdown` | `^0.9.0` | dependencies |
| `zod` | `^4.0.0` | dependencies |
| `@aws-sdk/client-s3` | `^3.947.0` | devDependencies |
| `@electron/packager` | `^19.0.1` | devDependencies |
| `@playwright/test` | `1.49.1` | devDependencies |
| `@rollup/rollup-win32-arm64-msvc` | `^4.55.1` | devDependencies |
| `@sentry/vite-plugin` | `^4.8.0` | devDependencies |
| `@tailwindcss/vite` | `^4.1.18` | devDependencies |
| `@types/bun` | `latest` | devDependencies |
| `@types/js-yaml` | `^4.0.9` | devDependencies |
| `@types/katex` | `^0.16.8` | devDependencies |
| `@types/linkify-it` | `^5.0.0` | devDependencies |
| `@types/node` | `^25.0.8` | devDependencies |
| `@types/react` | `^18.3.0` | devDependencies |
| `@types/react-dom` | `^18.3.0` | devDependencies |
| `@types/semver` | `^7.7.1` | devDependencies |
| `@types/shell-quote` | `^1.7.5` | devDependencies |
| `@types/uuid` | `^11.0.0` | devDependencies |
| `@typescript-eslint/eslint-plugin` | `^8.52.0` | devDependencies |
| `@typescript-eslint/parser` | `^8.52.0` | devDependencies |
| `@vitejs/plugin-react` | `^5.1.2` | devDependencies |
| `autoprefixer` | `^10.4.23` | devDependencies |
| `concurrently` | `^9.2.1` | devDependencies |
| `electron` | `^39.2.7` | devDependencies |
| `electron-builder` | `^26.0.12` | devDependencies |
| `esbuild` | `^0.25.0` | devDependencies |
| `eslint` | `^9.39.2` | devDependencies |
| `eslint-plugin-react` | `^7.37.5` | devDependencies |
| `eslint-plugin-react-hooks` | `^7.0.1` | devDependencies |
| `husky` | `^9.1.7` | devDependencies |
| `openai` | `^6.18.0` | devDependencies |
| `postcss` | `^8.5.6` | devDependencies |
| `react-devtools-core` | `^6.1.1` | devDependencies |
| `tailwindcss` | `^4.1.18` | devDependencies |
| `tar` | `^7.5.2` | devDependencies |
| `typescript` | `^5.0.0` | devDependencies |
| `vite` | `^6.2.4` | devDependencies |
| `@img/sharp-darwin-arm64` | `0.34.5` | optionalDependencies |
| `@img/sharp-darwin-x64` | `0.34.5` | optionalDependencies |
| `@img/sharp-libvips-darwin-arm64` | `1.2.4` | optionalDependencies |
| `@img/sharp-libvips-darwin-x64` | `1.2.4` | optionalDependencies |
| `@img/sharp-libvips-linux-arm64` | `1.2.4` | optionalDependencies |
| `@img/sharp-libvips-linux-x64` | `1.2.4` | optionalDependencies |
| `@img/sharp-linux-arm64` | `0.34.5` | optionalDependencies |
| `@img/sharp-linux-x64` | `0.34.5` | optionalDependencies |

## [CANDIDATE-DEP] @craft-agent/cli — [apps/cli/package.json](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/cli/package.json#L1)

| Dependency | Constraint | Role |
| --- | --- | --- |
| `@craft-agent/server-core` | `workspace:*` | dependencies |
| `@craft-agent/shared` | `workspace:*` | dependencies |
| `@types/bun` | `latest` | devDependencies |
| `@types/node` | `^22.0.0` | devDependencies |
| `typescript` | `^5.8.2` | devDependencies |

## [CANDIDATE-DEP] @craft-agent/cloud-gateway — [apps/cloud-gateway/package.json](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/cloud-gateway/package.json#L1)

| Dependency | Constraint | Role |
| --- | --- | --- |
| `@cloudflare/computer` | `0.1.0-alpha.1` | dependencies |
| `@cloudflare/workers-types` | `^4.20260702.1` | devDependencies |
| `typescript` | `^5.9.0` | devDependencies |
| `wrangler` | `^4.115.0` | devDependencies |

## [CANDIDATE-DEP] @craft-agent/electron — [apps/electron/package.json](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/package.json#L1)

| Dependency | Constraint | Role |
| --- | --- | --- |
| `@craft-agent/core` | `workspace:*` | dependencies |
| `@craft-agent/messaging-gateway` | `workspace:*` | dependencies |
| `@craft-agent/server-core` | `workspace:*` | dependencies |
| `@craft-agent/shared` | `workspace:*` | dependencies |
| `@craft-agent/ui` | `workspace:*` | dependencies |
| `@dnd-kit/core` | `^6.3.1` | dependencies |
| `@dnd-kit/sortable` | `^10.0.0` | dependencies |
| `@dnd-kit/utilities` | `^3.2.2` | dependencies |
| `@paper-design/shaders-react` | `^0.0.69` | dependencies |
| `@pierre/diffs` | `^1.0.4` | dependencies |
| `@radix-ui/react-context-menu` | `^2.2.16` | dependencies |
| `@radix-ui/react-dialog` | `^1.1.15` | dependencies |
| `@radix-ui/react-dropdown-menu` | `^2.1.16` | dependencies |
| `@radix-ui/react-label` | `^2.1.8` | dependencies |
| `@radix-ui/react-popover` | `^1.1.15` | dependencies |
| `@radix-ui/react-switch` | `^1.2.6` | dependencies |
| `@tanstack/react-table` | `^8.21.3` | dependencies |
| `@xyflow/react` | `^12.11.3` | dependencies |
| `buffer` | `^6.0.3` | dependencies |
| `chrono-node` | `^2.9.0` | dependencies |
| `cmdk` | `^1.1.1` | dependencies |
| `electron-log` | `^5.4.3` | dependencies |
| `electron-updater` | `^6.8.0` | dependencies |
| `i18next-browser-languagedetector` | `^8.2.1` | dependencies |
| `jotai-family` | `^1.0.1` | dependencies |
| `motion` | `^12.23.26` | dependencies |
| `next-themes` | `^0.4.6` | dependencies |
| `process` | `^0.11.10` | dependencies |
| `qrcode.react` | `^4.2.0` | dependencies |
| `react` | `^18.3.1` | dependencies |
| `react-colorful` | `^5.7.0` | dependencies |
| `react-day-picker` | `^9.13.0` | dependencies |
| `react-dom` | `^18.3.1` | dependencies |
| `react-i18next` | `^17.0.2` | dependencies |
| `react-pdf` | `^10.3.0` | dependencies |
| `react-simple-code-editor` | `^0.14.1` | dependencies |
| `remark` | `^15.0.1` | dependencies |
| `sharp` | `0.35.0` | dependencies |
| `sonner` | `^2.0.7` | dependencies |
| `strip-markdown` | `^6.0.0` | dependencies |
| `undici` | `^7.22.0` | dependencies |
| `unist-util-visit` | `^5.0.0` | dependencies |
| `vaul` | `^1.1.2` | dependencies |
| `ws` | `^8.19.0` | dependencies |
| `@types/ws` | `^8.18.1` | devDependencies |

## [CANDIDATE-DEP] @craft-agent/viewer — [apps/viewer/package.json](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/viewer/package.json#L1)

| Dependency | Constraint | Role |
| --- | --- | --- |
| `@craft-agent/core` | `workspace:*` | dependencies |
| `@craft-agent/ui` | `workspace:*` | dependencies |
| `react` | `^18.3.1` | dependencies |
| `react-dom` | `^18.3.1` | dependencies |
| `react-i18next` | `^17.0.2` | dependencies |
| `@tailwindcss/typography` | `^0.5.16` | devDependencies |
| `@tailwindcss/vite` | `^4.0.0` | devDependencies |
| `@vitejs/plugin-react` | `^4.4.1` | devDependencies |
| `class-variance-authority` | `^0.7.1` | devDependencies |
| `clsx` | `^2.1.1` | devDependencies |
| `lucide-react` | `^0.501.0` | devDependencies |
| `motion` | `^12.0.0` | devDependencies |
| `react-markdown` | `^9.0.3` | devDependencies |
| `rehype-raw` | `^7.0.0` | devDependencies |
| `remark-gfm` | `^4.0.1` | devDependencies |
| `shiki` | `^3.0.0` | devDependencies |
| `tailwind-merge` | `^2.6.0` | devDependencies |
| `tailwindcss` | `^4.0.0` | devDependencies |
| `typescript` | `^5.7.3` | devDependencies |
| `vite` | `^6.2.5` | devDependencies |

## [CANDIDATE-DEP] @craft-agent/webui — [apps/webui/package.json](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/webui/package.json#L1)

| Dependency | Constraint | Role |
| --- | --- | --- |
| `@craft-agent/core` | `workspace:*` | dependencies |
| `@craft-agent/shared` | `workspace:*` | dependencies |
| `@craft-agent/ui` | `workspace:*` | dependencies |
| `i18next` | `^26.0.3` | dependencies |
| `i18next-browser-languagedetector` | `^8.2.1` | dependencies |
| `jotai` | `^2.16.0` | dependencies |
| `react` | `^18.3.1` | dependencies |
| `react-dom` | `^18.3.1` | dependencies |
| `react-i18next` | `^17.0.2` | dependencies |
| `sonner` | `^2.0.7` | dependencies |

## [CANDIDATE-DEP] @craft-agent/workspace-service — [apps/workspace-service/package.json](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/workspace-service/package.json#L1)

| Dependency | Constraint | Role |
| --- | --- | --- |
| `@craft-agent/server-core` | `workspace:*` | dependencies |
| `@craft-agent/shared` | `workspace:*` | dependencies |
| `jose` | `^6.0.0` | dependencies |
| `ws` | `^8.19.0` | dependencies |

## [CANDIDATE-DEP] @craft-agent/cloud-runner — [packages/cloud-runner/package.json](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/cloud-runner/package.json#L1)

| Dependency | Constraint | Role |
| --- | --- | --- |
| None declared | — | Source/contracts package |

## [CANDIDATE-DEP] @craft-agent/core — [packages/core/package.json](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/core/package.json#L1)

| Dependency | Constraint | Role |
| --- | --- | --- |
| `yaml` | `^2.8.2` | dependencies |
| `@types/uuid` | `^11.0.0` | devDependencies |
| `@anthropic-ai/claude-agent-sdk` | `0.3.258` | peerDependencies |
| `@modelcontextprotocol/sdk` | `>=1.29.0` | peerDependencies |

## [CANDIDATE-DEP] @craft-agent/messaging-discord-worker — [packages/messaging-discord-worker/package.json](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-discord-worker/package.json#L1)

| Dependency | Constraint | Role |
| --- | --- | --- |
| `discord.js` | `^14.16.0` | dependencies |
| `@types/node` | `^22.0.0` | devDependencies |
| `typescript` | `^5.8.2` | devDependencies |

## [CANDIDATE-DEP] @craft-agent/messaging-gateway — [packages/messaging-gateway/package.json](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-gateway/package.json#L1)

| Dependency | Constraint | Role |
| --- | --- | --- |
| `@craft-agent/core` | `workspace:*` | dependencies |
| `@craft-agent/messaging-discord-worker` | `workspace:*` | dependencies |
| `@craft-agent/messaging-whatsapp-worker` | `workspace:*` | dependencies |
| `@craft-agent/server-core` | `workspace:*` | dependencies |
| `@craft-agent/shared` | `workspace:*` | dependencies |
| `@larksuiteoapi/node-sdk` | `^1.62.1` | dependencies |
| `grammy` | `^1.35.0` | dependencies |
| `qrcode-terminal` | `0.12.0` | dependencies |
| `@types/node` | `^22.0.0` | devDependencies |
| `typescript` | `^5.8.2` | devDependencies |

## [CANDIDATE-DEP] @craft-agent/messaging-whatsapp-worker — [packages/messaging-whatsapp-worker/package.json](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-whatsapp-worker/package.json#L1)

| Dependency | Constraint | Role |
| --- | --- | --- |
| `@whiskeysockets/baileys` | `^6.7.0` | dependencies |
| `@types/node` | `^22.0.0` | devDependencies |
| `typescript` | `^5.8.2` | devDependencies |

## [CANDIDATE-DEP] @craft-agent/pi-agent-server — [packages/pi-agent-server/package.json](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/pi-agent-server/package.json#L1)

| Dependency | Constraint | Role |
| --- | --- | --- |
| `@craft-agent/core` | `workspace:*` | dependencies |
| `@craft-agent/session-tools-core` | `workspace:*` | dependencies |
| `@earendil-works/pi-agent-core` | `0.85.1` | dependencies |
| `@earendil-works/pi-ai` | `0.85.1` | dependencies |
| `@earendil-works/pi-coding-agent` | `0.85.1` | dependencies |
| `duck-duck-scrape` | `^2.2.7` | dependencies |
| `node-html-parser` | `^6.1.0` | dependencies |
| `pdfjs-dist` | `^5.4.0` | dependencies |
| `turndown` | `^7.2.0` | dependencies |
| `@types/node` | `^22.0.0` | devDependencies |

## [CANDIDATE-DEP] @craft-agent/server-core — [packages/server-core/package.json](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/package.json#L1)

| Dependency | Constraint | Role |
| --- | --- | --- |
| `@craft-agent/cloud-runner` | `workspace:*` | dependencies |
| `@craft-agent/core` | `workspace:*` | dependencies |
| `@craft-agent/session-tools-core` | `workspace:*` | dependencies |
| `@craft-agent/shared` | `workspace:*` | dependencies |
| `@earendil-works/pi-ai` | `0.85.1` | dependencies |
| `@tursodatabase/database` | `0.7.2` | dependencies |
| `@xenova/transformers` | `2.17.2` | dependencies |
| `gray-matter` | `^4.0.3` | dependencies |
| `jose` | `^6.0.0` | dependencies |
| `js-yaml` | `^4.1.1` | dependencies |
| `sharp` | `0.35.0` | dependencies |
| `ws` | `^8.19.0` | dependencies |
| `typescript` | `^5.8.2` | devDependencies |

## [CANDIDATE-DEP] @craft-agent/server — [packages/server/package.json](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server/package.json#L1)

| Dependency | Constraint | Role |
| --- | --- | --- |
| `@craft-agent/core` | `workspace:*` | dependencies |
| `@craft-agent/messaging-gateway` | `workspace:*` | dependencies |
| `@craft-agent/server-core` | `workspace:*` | dependencies |
| `@craft-agent/shared` | `workspace:*` | dependencies |
| `@types/node` | `^22.0.0` | devDependencies |
| `typescript` | `^5.8.2` | devDependencies |
| `ws` | `^8.16.0` | devDependencies |

## [CANDIDATE-DEP] @craft-agent/session-mcp-server — [packages/session-mcp-server/package.json](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/session-mcp-server/package.json#L1)

| Dependency | Constraint | Role |
| --- | --- | --- |
| `@craft-agent/session-tools-core` | `workspace:*` | dependencies |
| `@craft-agent/shared` | `workspace:*` | dependencies |
| `@modelcontextprotocol/sdk` | `^1.29.0` | dependencies |
| `zod` | `^4.0.0` | dependencies |
| `@types/node` | `^22.0.0` | devDependencies |

## [CANDIDATE-DEP] @craft-agent/session-tools-core — [packages/session-tools-core/package.json](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/session-tools-core/package.json#L1)

| Dependency | Constraint | Role |
| --- | --- | --- |
| `@craft-agent/core` | `workspace:*` | dependencies |
| `beautiful-mermaid` | `*` | dependencies |
| `gray-matter` | `^4.0.3` | dependencies |
| `zod` | `^3.23.0` | dependencies |
| `zod-to-json-schema` | `^3.25.0` | dependencies |
| `typescript` | `^5.8.2` | devDependencies |

## [CANDIDATE-DEP] @craft-agent/shared — [packages/shared/package.json](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/package.json#L1)

| Dependency | Constraint | Role |
| --- | --- | --- |
| `@craft-agent/core` | `workspace:*` | dependencies |
| `@craft-agent/session-tools-core` | `workspace:*` | dependencies |
| `@earendil-works/pi-agent-core` | `0.85.1` | dependencies |
| `@earendil-works/pi-ai` | `0.85.1` | dependencies |
| `@earendil-works/pi-coding-agent` | `0.85.1` | dependencies |
| `@isaacs/ttlcache` | `^2.1.4` | dependencies |
| `@leeoniya/ufuzzy` | `^1.0.19` | dependencies |
| `bash-parser` | `^0.5.0` | dependencies |
| `croner` | `^10.0.1` | dependencies |
| `date-fns` | `^4.1.0` | dependencies |
| `filtrex` | `^3.1.0` | dependencies |
| `glob` | `^13.0.0` | dependencies |
| `i18next` | `^26.0.3` | dependencies |
| `incr-regex-package` | `^1.0.4` | dependencies |
| `shell-quote` | `^1.8.3` | dependencies |
| `yaml` | `^2.8.2` | dependencies |
| `@types/shell-quote` | `^1.7.5` | devDependencies |
| `@types/uuid` | `^11.0.0` | devDependencies |
| `@anthropic-ai/claude-agent-sdk` | `0.3.258` | peerDependencies |
| `@modelcontextprotocol/sdk` | `>=1.29.0` | peerDependencies |
| `zod` | `>=4.0.0` | peerDependencies |

## [CANDIDATE-DEP] @craft-agent/ui — [packages/ui/package.json](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/ui/package.json#L1)

| Dependency | Constraint | Role |
| --- | --- | --- |
| `@craft-agent/core` | `workspace:*` | dependencies |
| `@craft-agent/shared` | `workspace:*` | dependencies |
| `@paper-design/shaders-react` | `^0.0.69` | dependencies |
| `@types/mdast` | `^4.0.0` | dependencies |
| `@uiw/react-json-view` | `^2.0.0-alpha.40` | dependencies |
| `beautiful-mermaid` | `*` | dependencies |
| `fflate` | `^0.8.2` | dependencies |
| `nice-ticks` | `^1.0.2` | dependencies |
| `unified` | `^11.0.0` | dependencies |
| `unist-util-visit` | `^5.0.0` | dependencies |
| `@pierre/diffs` | `>=0.1.0` | peerDependencies |
| `@radix-ui/react-context-menu` | `>=2.0.0` | peerDependencies |
| `@radix-ui/react-dialog` | `>=1.0.0` | peerDependencies |
| `@radix-ui/react-dropdown-menu` | `>=2.0.0` | peerDependencies |
| `@tailwindcss/typography` | `>=0.5.0` | peerDependencies |
| `class-variance-authority` | `>=0.7.0` | peerDependencies |
| `clsx` | `>=2.0.0` | peerDependencies |
| `i18next` | `>=26.0.0` | peerDependencies |
| `jotai` | `>=2.0.0` | peerDependencies |
| `katex` | `>=0.16.0` | peerDependencies |
| `lucide-react` | `>=0.400.0` | peerDependencies |
| `motion` | `>=11.0.0` | peerDependencies |
| `react` | `>=18.0.0` | peerDependencies |
| `react-dom` | `>=18.0.0` | peerDependencies |
| `react-i18next` | `>=17.0.0` | peerDependencies |
| `react-markdown` | `>=9.0.0` | peerDependencies |
| `react-pdf` | `>=10.0.0` | peerDependencies |
| `rehype-katex` | `>=7.0.0` | peerDependencies |
| `rehype-raw` | `>=7.0.0` | peerDependencies |
| `remark-gfm` | `>=4.0.0` | peerDependencies |
| `remark-math` | `>=6.0.0` | peerDependencies |
| `shiki` | `^3.21.0` | peerDependencies |
| `tailwind-merge` | `>=2.0.0` | peerDependencies |
| `tailwindcss` | `>=4.0.0` | peerDependencies |
| `vaul` | `>=1.0.0` | peerDependencies |
