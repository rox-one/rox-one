# Skill and history recovery proof

The fixture builder reads the exact static test template from the checked-in Node test and bundles the current complete SkillInfoPage with real form primitives. Context/backend and unchanged presentation leaves are explicit seams.

Run from the repository root with supported Node 22 and an installed Playwright Chromium:

```sh
node apps/electron/src/renderer/pages/__tests__/skill-info-owner.fixture.mjs /tmp/rox-skill-current.js
ROX_SKILL_INFO_BROWSER_TEST=1 ROX_SKILL_INFO_FIXTURE_BUNDLE=/tmp/rox-skill-current.js node --experimental-strip-types --test apps/electron/src/renderer/pages/__tests__/skill-info-owner.browser.node.ts
```

Set `ROX_UI001_CHROMIUM_EXECUTABLE` to use a known Chromium executable. To compare an older SkillInfoPage, export its bytes with `git show <revision>:apps/electron/src/renderer/pages/SkillInfoPage.tsx` and pass that file as the builder's second argument. The override retains the original module's import directory; production checkout bytes stay unchanged.

Navigation's existing opt-in suite uses `ROX_UI001_BROWSER_TEST=1`; its 28 cases include the two added history failure controls. Archived logs under the integration task evidence directory retain previous failed fixture launch/cleanup attempts.
