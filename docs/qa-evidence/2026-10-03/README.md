# Synthetic skill inspection evidence

Qualified on current-main base `3342fad30166bdf005d296e0d5fe24d36d4df5fb`.

- `skills-before.png`: two synthetic craft skills selected, before activating a runtime skill.
- `skills-after.png`: bulk selection cleared and the selected runtime instructions displayed from a disposable real file.

These images show the actual skill list, MainContentPanel bulk/detail decision,
and SkillInfoPage in a controlled browser fixture. They do not show an installed
application or real user workspace. The before image is the interaction's bulk
state, not a claim of an installed-app defect reproduction.

Capture from the repository root using the pinned Playwright installation:

```powershell
$env:ROX_QA_CAPTURE_DOCS='1'
node node_modules/@playwright/test/cli.js test --config tests/e2e/qa-observations/playwright.config.ts --grep OBS-001
```

Transport is a local HTTP adapter to the actual skills RPC/storage code; context,
header, avatars, editing dialogs, and unrelated surfaces are isolated doubles.
All profiles, configuration, files, skill names, and instruction bodies are synthetic.
