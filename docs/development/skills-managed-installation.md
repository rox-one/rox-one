# Application-owned skills

Bundled and marketplace skills install under `<Rox config>/skills`, independently of the user's `~/.agents/skills` directory. The app discovers its own store directly; optional directory links expose those skills to external agents. Windows uses junctions and macOS/Linux use directory symlinks. An unavailable link does not prevent app discovery or message activation.

Same-name skills receive a qualified identity such as `pack-b--review`. The stored original-to-installed mapping keeps that identity stable on restart and update, including when the original name becomes free. A user skill keeps its existing name and content. If a user later creates a colliding workspace/project/global skill, the app skill remains selectable through an explicit `rox--…` alias. Repeated display names show their distinct `@` identities in the skills list.

Directory-mode marketplace packs retain their pinned repository layout and integrity hash. Their provenance marker exposes bounded, qualified views of nested `SKILL.md` files, including duplicate basenames. The app resolves these views without changing the repository or requiring symlink permissions. Native file listing and editor actions resolve the displayed identity to its actual path.

Updates preserve local changes. Removed untouched skills and their owned links are retired; removed edited skills remain tracked so disabling/removal can still handle them. Uninstall removes untouched owned content and exact managed links, preserves edited files and foreign targets, and never follows a replaced target symlink to delete its destination. Content pins apply to the original checkout name, independently of the chosen local alias. Unsafe identities and checkout symlinks fail before installation.

Verification uses real temporary files, application stores, symlinks and a synthetic `HOME`, with no network calls or personal global skill modifications. The focused suite passes 78 tests; its isolated acceptance process adds twelve scenarios covering actual `BaseAgent.extractSkillPaths`, native file actions, duplicate packs/user names, persistent aliases, optional-link failure, directory packs, updates, disabled discovery, uninstall ownership and failed-update rollback. A blocked aggregate lock commit preserves the complete old marker, nested views, aliases and files for swapped, locally edited and legacy unmarked targets. The proof is saved under `/workspace/scratch/rox-ui-review-2026-10-03/skills-managed-acceptance.json`. Native Windows/macOS execution remains a CI check; Linux execution does not establish that gate.

Run the relevant checks with:

```sh
bun test packages/shared/src/skills packages/shared/src/marketplace/__tests__/installer.test.ts apps/electron/src/renderer/shims/__tests__/node-stub.test.ts packages/server-core/src/handlers/rpc/__tests__/skills-workspace-auth.test.ts
```
