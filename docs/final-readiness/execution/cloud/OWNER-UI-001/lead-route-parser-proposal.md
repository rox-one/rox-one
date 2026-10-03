# Lead-owned route-parser proposal (not applied)

Input: 76228cc33e44518e5fab5e59f5c754f4051d1e8c. Owned UI code cannot recover a raw link after the parser has silently converted it into sessions/allSessions. Existing examples include unknown prefixes and knowledge/unknown-kind/id.

The adjacent patch is a minimum concrete candidate: malformed surface compound routes return null, unknown view prefixes return null, the NavigationState parser carries a typed unavailable state with the original raw route, and the route builder preserves it. The proposed type change belongs to the lead too. No shared source file was edited.

Before integration, the lead must check action/view compatibility, malformed percent encodings, every NavigationState consumer and nullable compound conversion, URL/sidebar reconciliation, route-fallback auto-selection and all existing parser tests. Add direct-link/reload/back/forward/invalid-encoding tests for the new type and ensure typed unavailable routes are never replaced by auto-selected sessions. Duplicate pages/page-info switch branches at current source lines 1321/1323 and 1347/1349 are another source warning to review.

This is a review artifact, not a qualified or complete parser implementation; full acceptance must use the final integrated candidate and real target workflows.

Read-only executable probe (`evidence/parser-gap-probe.log`) also shows NavigationContext.resolveAutoSelection turns an explicit deleted-session link into unrelated-session. The lead must preserve explicit session identity through metadata loading/deletion, enforce workspace ownership, and show the existing ChatPage missing state. This callback is outside OWNER-UI-001 scope and is not changed by either the product patch or the parser candidate. The parser candidate now carries invalid percent encodings as an unavailable state rather than allowing URIError to escape.

The additional `lead-layout-test-proposal.patch` replaces the non-owned source-text declaration assertion with a real atom default assertion. It has not been applied. The `sash-terminal-clearance` fixture still expects zero top inset while input source uses four; both that test and panel-constants.ts are outside this owner's paths.
