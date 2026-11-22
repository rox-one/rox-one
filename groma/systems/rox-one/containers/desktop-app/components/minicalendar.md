---
type: C4 Component
title: MiniCalendar
status: stable
groma:
  id: minicalendar
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/screens/calendar/MiniCalendar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/screens/calendar/MiniCalendar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/screens/calendar/calendar-sidebar-sections.ts
    - scanner: typescript
      file: apps/electron/src/renderer/screens/calendar/calendar-visibility.ts
    - scanner: typescript
      file: apps/electron/src/renderer/screens/calendar/useCalendarScreenSidebar.ts
description: Renders the month grid in the Календарь sidebar with meeting dots and day filtering.
---
