# UI-001 end-to-end route recovery repair

Continue the verified PR1400 implementation on main635fc495d02c3fe1380740444cb90cf4fbdb58d9. The user explicitly authorizes full source repair and all GitHub writes, including main merge. Preserve the original UI-001.1/UI-001.2 Requirements, DoD, Full functional verification and Test method in verification/original-contract.json unchanged. Preserve historical results and failures.

Explicit selected entity addresses must survive missing/deleted entities, readiness races, workspace switching, history and reload. Unknown/malformed view routes must retain their raw address on an unavailable surface; they must never select an unrelated chat. Pending navigation must preserve encoding, nested addresses, query parameters and options. Canonical async data must be fenced against older requests, deletion events and workspace changes. Shell geometry must remain valid, accessible and persistent.

Use exact Bun1.3.14, isolated source/profile/runtime, actual callbacks and a rebuilt Electron product with canonical seeded stores for local native proof. Windows, actual hosted-web and provider/service acceptance remain external prerequisites until observed. fullDoDClosed remains false unless every original target acceptance is actually observed. No deployment, signing, real provider calls or global configuration/permission changes are required.
