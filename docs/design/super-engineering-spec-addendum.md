# Addendum: super.engineering profile vs `docs/spec.md` §5.2

This addendum scoped SE parity without superseding September program acceptance for the then-default Rox chrome. As of 2026-10-23 Rox Engineering is the new-install default theme; September U06/U15 rules still apply to non-SE themes and to explicit user picks.

| September rule | Default Rox | SE profile (`super-engineering` theme) |
|----------------|-------------|----------------------------------------|
| U06 Inter + Rox `rox copy.png` | Required | SE may use system UI stack + SE logo on hub only |
| U15 Flexoki / Snazzy / Snazzy Blurred | Required themes | **Additional** preset; blur like Snazzy Blurred, not global Liquid Glass |
| Onboarding name-only (spec §5.2) | Required | SE 4-step wizard **only** when profile selected or first-run flag for SE |
| Compact sidebar icons align (U06) | Required | Rox `LeftSidebar` unchanged; SE uses **WorkspaceNavigator** |

**Non-goals (historical through 2026-10-14):** Enabling SE for all users; changing `main` default theme; Zed importer.
**Update 2026-10-23:** Rox Engineering is now the default theme for new installs (`ROX_THEME_ID = super-engineering`). Existing explicit theme picks are preserved; Arc Glass remains selectable.
