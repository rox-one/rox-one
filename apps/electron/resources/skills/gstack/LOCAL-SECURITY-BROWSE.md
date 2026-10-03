# ROX browser helper filesystem review

Both curated and full-package browser helpers use the same bounded descriptor reads and private writes. The curated copy retains its own local buffers/session globals; shared `lib` imports now point to the full sibling package instead of a missing directory.

- HTML file/payload, cookie command input and eval source are read through stable bounded regular descriptors.
- Eval text/base64, screenshots, scrape manifests/media, archives and downloaded files use secure private descriptor writes. Browser screenshots are received as bytes before publication.
- Default navigation-download/scrape/archive/pretty-screenshot destinations use private `mkdtemp` directories. Failed navigation downloads remove unused temporary directories.
- Publication-lock reads use stable 4096-byte descriptor bounds; existing generation/process ownership and bigint inode checks remain. Lock release leaves a replacement owner's lock intact.

Alerts covered: 742, 741, 740, 716, 715, 714, 630–624, 619–615. Remote scan closure is pending; no exclusions or dismissals were introduced.

Functional regressions: `gstack-browse-io.test.ts`, 6 tests / 38 assertions, both copies. Tests execute actual HTML/eval dispatch with a fake page, actual eval output text/base64 conversion, private permissions, symlink refusal and lock ownership preservation. No browser, network, credential import or device action is performed.
