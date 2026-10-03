# Lead-owned route recovery gaps

The approved owned-file patch does not edit NavigationContext.tsx or shared/route-parser.ts. Full UI-001.1 remains open.

1. NavigationContext resolveAutoSelection drops explicitly selected missing or cross-workspace session IDs and then selects another session. Preserve explicit details; apply auto-selection only to bare session-list routes. ChatPage already supplies a missing state. Verify direct navigation, initial raw URL, back/forward, cross-workspace and deletion while another live session exists.
2. Parser failure in focused-route projection returns DEFAULT_NAVIGATION_STATE, while invalid initial route restoration yields no replacement entry. Preserve raw unsupported routes through a typed unavailable state/history reconciliation rather than substituting a sessions route. Define the type and round-trip serializer together in the lead-owned parser/context contract. Test unknown routes and malformed percent encodings without treating fabricated unsupported NavigationState as end-to-end URL proof.
3. Existing baseline sash-terminal-clearance test expects PANEL_STACK_TOP_INSET=0 while current panel-constants.ts defines 4. Both main baseline and candidate retain that unrelated failure; owner must reconcile intended spacing and assertion.
