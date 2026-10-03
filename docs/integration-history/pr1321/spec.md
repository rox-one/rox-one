# Sidebar visibility in the desktop shell

## Goal

The left navigation follows the user's saved sidebar preference on every route, including Meetings, Settings, and other module screens. The title-bar sidebar button must immediately show or hide that navigation on the current route. The selection survives a renderer reload.

## Constraints

- Keep the activity rail and contextual module panels separate from the left navigation.
- Preserve compact and focus modes, where available width or an explicit focus choice can hide shell panels.
- Preserve the user's profile and workspace data.

## Acceptance

1. From a session, open Meetings and confirm the left navigation remains visible.
2. Toggle the sidebar on Meetings and confirm each click changes its visibility.
3. Reload the renderer and confirm the last selected visibility remains in effect.
4. Verify the session view still shows its list and content panels.
