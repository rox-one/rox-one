# ROX compound helper security review

ROX preserves these helpers' purpose: render locally authored executable prototype
screens and carry a user's selected polish session to its authenticated endpoint.
The helper root and `OPENAI_BASE_URL` are explicit CLI/environment configuration.
Prototype screens must be trusted authoring output; HTML/JavaScript remains active.
These helpers default to loopback and are not a service for uploading untrusted HTML.

## Local patches

- Both light web servers reject decoded traversal, Windows path separators, and
  NULs. Screen/asset reads open a regular file with `O_NOFOLLOW`, verify containment
  and descriptor identity, and read that same descriptor. Symlinks below the
  selected root, including internal symlinks, are refused. A platform alias for the
  selected root itself is supported (for example macOS `/tmp`). Unstable reads
  fail closed.
- Private state directories use 0700; state files/logs use 0600. Writes use an
  owned `mkdtemp` directory and an exclusive file, then atomic rename. Existing
  output symlinks are replaced, never followed. Append opens reject symlinks.
- Polish replay reads its selected frame through the same descriptor helper.
- The annotation overlay only reloads a same-origin local document path; protocol
  URLs, protocol-relative URLs, backslashes, and control characters are refused.

## CodeQL findings reviewed without exclusions or suppression

| Alerts | Source boundary and disposition |
| --- | --- |
| 559–564 | Screen/path reads: fixed descriptor confinement and traversal checks. |
| 905 | Predictable private temporary output: replaced with owned exclusive temp. |
| 556 | Overlay DOM-derived navigation target: constrained to same-origin path. |
| 903, 904 | Dispatch path chooses a handler, never an authentication exemption. `handleSessionProbe` calls `authorizePageToken`; `PAGE_ROUTES` call `authorizePage`; agent routes call `authorizeAgent` before any dispatch or mutation. OPTIONS returns only empty CORS metadata. Actual HTTP negative controls cover these boundaries. |
| 557, 558 | Active local prototype HTML is intentional helper functionality. Screens are authored local programs, not user comments interpolated into a privileged application template. Escaping the complete screen would disable the skill. File confinement is repaired and executable screen behavior is covered explicitly. |
| 813, 814, 817, 818 | The `wait` command reads the credential for the running helper and sends it to that configured helper endpoint. Retained private session data is required for wait/resume. These are intended authenticated local/helper requests. |
| 819 | An authorized polish page/session asks for a realtime client secret from the configured OpenAI endpoint. `authorizePage` checks page credential/session/origin first; `handleMint` additionally validates loopback or explicitly trusted TLS proxy, rate limits, and rejects a secret-containing brief. Provider authorization is required functionality; the response/error paths do not return the provider API key. |

Regression: `bun test packages/shared/src/skills/__tests__/compound-helper-security.test.ts`.
Tests create temporary roots and loopback processes only, remove them on exit, and
neither open a browser nor use a user's API credentials. Their assertions cover
symlink swaps at the open boundary, inode replacement after open, private output,
HTTP traversal, route credentials/origin separation, and executable prototype HTML.
A fresh remote CodeQL analysis is still required to establish scanner disposition.
