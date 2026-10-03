Exact candidate `010fa8c040e3a84cd40cd8195473f52d8582f159`, detached isolated checkout `/tmp/rox-r15-exact-ui-20261001/checkout`. All five fresh commands completed exit 0; full 6178 source/lock files + 2 gitlinks matched before/after each.

- validate:ci: 199.679s, 248 Bun tests + 19 Python tests, zero failures, 708 expect calls; workers/pages absent and explicitly skipped.
- webui:typecheck: 73.983s.
- full electron:build: 126.565s, 8414 modules transformed.
- renderer closure: 408 maps, 1192/1192 exact textual source entries, 23 generated asset wrappers, all 19 required shell sources and 5 HTML entries.
- Actual built SQLite initializer: Node24, 16 assertions; readonly/closed/rollback/restart persisted.
- Whole main.cjs constrained Electron host stub: require returned, two held readiness gates, zero windows/network/children/outside reads/outside writes. This is not native Electron acceptance.

Owner SQLite adapter sha256 `8cd80233dc566a9433cd1b589222ca7cebbcf61ff5a09fff81c29702f5bfc831` unchanged. Own private config/cache/tmp cleaned, no own processes active. Shared checkout/deps/dist retained. Original checkout unchanged and clean. No environment draft or app source edits.
