# 05 — Mount knowledge-to-session CTAs

**What to build:** From a knowledge document the user can ask about it or open a full session. The document mention survives session creation and is readable by `knowledge_read`.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `KnowledgeAgentPanel` is mounted on the knowledge entity surface
- [ ] “Ask about this document” opens a session with the mention token in the composer
- [ ] “Open full session” creates a session and sends the brief
- [ ] Empty Inbox/Daily/Tags either hide or show a truthful empty state that does not look like a load failure
