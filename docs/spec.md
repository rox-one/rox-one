# Roadmap recovery — #1194

Baseline: `40391c087a255118ea475ea09039f03e301b64c8` from the existing `feat/project-roadmap` branch. Original two feature commits remain intact. This isolated recovery prepares a draft delivery and does not accept the complete project roadmap issue.

## Observable acceptance

1. Reads return an opaque revision of the exact canonical bytes, including corrupt and missing files. Saves with an observed revision reject stale state without changing the canonical or Markdown bytes.
2. Cooperating processes serialize the compare/write operation with an exclusive project-specific lock; a busy lock fails closed and is never stolen. Lock cleanup follows ordinary success and exceptions.
3. A corrupt canonical file must have an exclusive, successful backup before replacement. Backup collision or failure preserves both original bytes and any existing backup.
4. Existing callers without an observed token retain the existing local last-write API. New actual renderer saves use the read token, serialize acknowledgements, retain newer user edits and ignore acknowledgements from an old project. A failed load never enables an unobserved destructive save.
5. Successful saves reload the same canonical content/revision; stale updates and false saved states are rejected. Scoped source tests, real temporary filesystem/concurrent-process checks and a reviewable local commit substantiate these claims.
6. The resolved projects directory stays inside the resolved authorized workspace; project and canonical roadmap symlinks stay inside their respective scopes. Refused escaped paths preserve external bytes.

## Boundaries and remaining acceptance

This repair owns only the roadmap domain/storage helpers, focused tests, the existing ProjectInfoPage save caller and these documents. Shared RPC registries, organization ACL, global entity schema, locales, lockfile, other worktrees and provider settings retain their existing owners.

Current Projects RPC derives a workspace path and checks the existing Rox2 live capability gate. It does not establish the full actor/tenant/organization source ACL requested by #1194. This branch adds no competing authorization layer. Original issue stable entity references, cross-entity ACL, accepted DATA-01/SHARED-01 contract, transactional project lifecycle, AI source authorization, actual native interface, narrow/keyboard controls, installed restart and platform acceptance remain review/delivery gates.

The JSON file is canonical; Markdown is a derived mirror with its existing best-effort generation semantics. The lock fences cooperating writers, not arbitrary direct external filesystem edits. A crashed process may leave an exclusive lock; recovery requires the owner to establish that no writer is active before removing that specific lock. No automatic stale-lock takeover or power-loss/fsync guarantee is introduced. The acknowledged token is an opaque content hash, not the full shared entity revision contract.
