# ROX local helper security review

Reviewed against CodeQL analysis 1885378174 (source 2af860c5783dd4dd24209f030d119aeaf2e212e8).
Upstream identity and licenses remain unchanged; local edits are separately recorded in the vendor patch manifest.

| Alerts | Disposition | Evidence |
| --- | --- | --- |
| 600–603: insecure randomness | Fixed shared DOM helper: `randomUUID` or `getRandomValues`; unavailable secure randomness fails closed. The eight hexadecimal character protocol is preserved. | `browser-helper-security.test.ts` exercises fallback, UUID and unavailable crypto. |
| 925: missing origin check | Fixed: detector requires the same window and exact document origin. | Foreign source and foreign origin negative controls; own-window positive control. |
| 609/610: executable local helper scripts | Intended capability with constrained source. Both paths are literal (`modern-screenshot.js`, `detect.js`) at `http://localhost:<port>`; port is now an integer in 1–65535. No remote host/path supplied by a message is accepted. | Source review of both loaders and startup validation. A local service able to serve those endpoints is necessarily trusted for this explicitly requested live browser tool. No scanner exclusion or dismissal applied. |

Remote scanner closure is a separate result; this review does not assert that the fresh CodeQL job passed.
