# OBS-001 / OBS-002 controlled browser checks

Run from the repository root with its frozen Bun dependencies:

```powershell
bun install --frozen-lockfile
$env:PLAYWRIGHT_BROWSERS_PATH="$env:TEMP/opencode/playwright-browsers"
bun x playwright install chromium
bun x playwright test --config tests/e2e/qa-observations/playwright.config.ts
bun run tsc --noEmit -p tests/e2e/qa-observations/tsconfig.json
```

The fixture uses the actual SkillsListPanel, EntityPanel/EntityRow interactions,
MainContentPanel (including its real bulk-selection branch), MultiSelectPanel,
SkillInfoPage, PanelStackContainer, PanelSlot, panel-stack atoms, resize sash,
route builders/parsers, and renderer CSS. A separate Bun fixture invokes the
actual registered skills RPC handlers against 2,216 real disposable SKILL.md
files. Runtime list responses contain `content: ''`, exactly as in production.
Only `getSkillDetails` returns the selected runtime body. Current main's actual
MainContentPanel availability gate performs metadata reads before changed
selections; SkillInfoPage does not fetch a list or populate its cache with bodies.

Boundary doubles replace the Electron wire with local HTTP, AppShellContext,
the navigation hook (actual predicates/parser remain), action registration,
avatars, editing dialogs, skill menus, PanelHeader, and unrelated module surfaces.
MainContentPanel is real in skill tests. Only the viewport fixture replaces its
content body. The
viewport fixture uses controlled content with buttons at both horizontal edges;
the close button and panel state are real. It does **not** launch Electron,
access installed Rox, load user configuration, or test live chat/model RPC.
The synthetic settings/session content is not a screenshot of the full app.

OBS-001 reproduced before the first fix: a captured click arrived but did not
navigate. Independent review found two omissions in that first round. Disabling
the follow-up corrections reproduces both through the updated fixture: metadata
lookup renders “No instructions provided”, and runtime selection after two craft
selections leaves the real bulk panel showing. Tests now cover actual lazy bodies,
mouse/Enter/Space exit from bulk mode, export preserving bulk mode, errors/missing
responses, metadata-only refresh, and delayed previous-workspace responses.

Backend regression tests additionally cover one-body-read count, native/bound
workspace denial, registered project/session scope and foreign-directory denial,
craft/runtime precedence, unicode directory names/content, missing files, malformed
frontmatter, an escaping SKILL.md junction, and supported discovered directory links.
O3 cases verify project, workspace, shared-global, application, and runtime
canonical-file boundaries before either synchronous or asynchronous body reads.
They use real files with a controlled canonical-target redirect to a real regular
file outside the selected directory. Native Windows file-symlink creation was
EPERM in the independent review; these probes do not claim native link creation.
Legitimate directory junctions and current-main managed collision aliases are
covered separately. The common craft loader and runtime reader share one guard.
Run these alone (the `.isolated.ts` suffix keeps home/config isolation separate):

```powershell
bun test ./tests/e2e/qa-observations/backend-detail.isolated.ts
```

For the recorded verification, both ROX_CONFIG_DIR and CRAFT_CONFIG_DIR were set
to a disposable directory under `$TEMP/opencode/` before invoking Bun, and HOME /
USERPROFILE were also pointed there. Playwright config supplies isolated values
to its backend process before module loading. No installed profiles are read.

OBS-002 characterizes the current responsive grid at 1386×893 and 1000×893.
It checks settled panel geometry, control reachability and closing; scroll
restoration is checked where horizontal overflow exists. It does not impose the
older flex layout's 440px minimum. No viewport product edit is included.

Screenshots and Playwright failure artifacts are written under
`$TEMP/opencode/`. Console click-to-detail measurements cover development-mode
React rendering, a local HTTP wire adapter, actual RPC/storage code, and disposable
filesystem reads. They are development characterization, not production budgets.
