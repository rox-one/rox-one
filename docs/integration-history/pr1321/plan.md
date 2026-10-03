# Desktop sidebar restoration plan

Owner: ROX desktop shell. Dependency: an existing working desktop renderer.

1. Correct the broken shared stylesheet comment so the navigation styles load.
2. Align the activity rail offset with the actual mounted rail.
3. Apply the saved sidebar preference on all routes, leaving compact and focus handling in place.
4. Run focused navigation and chrome tests, then inspect the live Electron window on Sessions and Meetings.
5. Reload the renderer, verify persistence, and deliver the change through the sidebar PR.
