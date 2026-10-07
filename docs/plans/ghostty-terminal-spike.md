# T-20 Ghostty terminal embed — spike outcome

**Status:** blocked for Electron shell v1.

## Finding

- Rox Electron uses **xterm.js** + PTY via `BottomTerminalDock` / `InspectorTerminal`.
- **Ghostty** in repo = color theme JSON only (`resources/themes/ghostty.json`), not embedded terminal widget.
- No GPUI/native Ghostty bridge in `apps/electron`.

## Recommendation

- Keep bottom dock + inspector terminal on existing PTY path.
- Revisit when a maintained **native terminal embed** API exists for Electron (or shared Rust crate with GPUI host).

## User spec conflict

Product spec asked terminal split under **first panel column**; current architecture docks terminal under full shell width. Moving split requires `PanelHost` slot refactor — separate task after T-04 rail stable.
