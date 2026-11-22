---
type: C4 Component
title: PeopleList
status: stable
groma:
  id: peoplelist
  parent: ui-kit
  code:
    - scanner: react
      file: packages/ui/src/components/person-field/PeopleList.tsx
    - scanner: typescript
      file: packages/ui/src/components/person-field/PeopleList.tsx
    - scanner: react
      file: packages/ui/src/components/person-field/PersonField.tsx
    - scanner: typescript
      file: packages/ui/src/components/person-field/PersonField.tsx
    - scanner: typescript
      file: packages/ui/src/components/person-field/index.ts
description: Provides a searchable, keyboard-navigable people listbox and avatar fallback.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/ui/src/components/person-field/PeopleList.tsx](../../../../../../packages/ui/src/components/person-field/PeopleList.tsx) | [packages/ui/src/components/subscribers-picker/SubscribersPicker.tsx](../../../../../../packages/ui/src/components/subscribers-picker/SubscribersPicker.tsx) | Invokes supplied callbacks: onEscape, onPick | react |
