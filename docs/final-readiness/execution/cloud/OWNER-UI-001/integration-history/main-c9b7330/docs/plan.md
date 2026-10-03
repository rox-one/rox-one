# Dependency graph

1. Scout (patch_scout): verify provenance, refs, qualified runtime and merge capability. Complete.
2. Geometry (geometry): validate actual Jotai writes/reload/events and persistence errors. Depends on recovered patch and frozen install.
3. Recovery (root): isolate entity/workspace state, live deletion and async races, retry errors with original selection. Depends on recovered patch.
4. Independent review (spec_review, patch_scout): review requirements and integrated changes. Depends on product edits.
5. Integration (root): exact Bun regression/typecheck/build, result JSON and revision manifests, commit, PR, verify CI, merge with expected head, remote readback. Depends on 2-4.
