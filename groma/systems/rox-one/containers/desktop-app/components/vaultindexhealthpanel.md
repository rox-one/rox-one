---
type: C4 Component
title: VaultIndexHealthPanel
status: stable
groma:
  id: vaultindexhealthpanel
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/notes/VaultIndexHealthPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/VaultIndexHealthPanel.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/notes/NotesCommentThreads.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/NotesCommentThreads.tsx
      symbol: NotesCommentThreads
    - scanner: react
      file: apps/electron/src/renderer/pages/notes/NotesTemplatesDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/NotesTemplatesDialog.tsx
      symbol: NotesTemplatesDialog
    - scanner: react
      file: apps/electron/src/renderer/pages/notes/VersionHistoryPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/VersionHistoryPanel.tsx
      symbol: VersionHistoryPanel
    - scanner: react
      file: apps/electron/src/renderer/pages/notes/NoteLibraryChrome.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/NoteLibraryChrome.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/notes/NotesDocumentChrome.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/NotesDocumentChrome.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/notes/VaultInsightsPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/VaultInsightsPanel.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/notes/NotesViewHost.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/NotesViewHost.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/notes/NoteShareDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/NoteShareDialog.tsx
      symbol: NoteShareDialog
    - scanner: react
      file: apps/electron/src/renderer/pages/notes/NotesDialogs.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/NotesDialogs.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/notes/NotesAIMenu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/NotesAIMenu.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/notes/NotesWorkspaceChrome.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/NotesWorkspaceChrome.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/notes/NotesNavigationSidebar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/NotesNavigationSidebar.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/notes/NotesReadingChrome.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/NotesReadingChrome.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/notes/NoteInspector.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/NoteInspector.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/daily-sessions.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/note-pdf-export.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/document-outline.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/wiki-autocomplete.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/comment-drafts.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/note-ai.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/request-state.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/document-ia.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/note-views.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/focus-state.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/version-history-diff.ts
      symbol: previewDiff
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/comment-highlights.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/note-comments.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/notes-layout.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/note-library.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/notes/project-note-scope.ts
description: Displays notes index health with schema, document count and a rebuild action in the notes inspector.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/pages/notes/NoteInspector.tsx](../../../../../../apps/electron/src/renderer/pages/notes/NoteInspector.tsx) | [apps/electron/src/renderer/pages/NotesPage.tsx](../../../../../../apps/electron/src/renderer/pages/NotesPage.tsx) | Invokes supplied callbacks: onAddProperty, onAddTag, onApplyTags, onMissingLink, onOpenNote, onTagClick, onToggleTask, onUpdateProperty | react |
| [apps/electron/src/renderer/pages/notes/NoteLibraryChrome.tsx](../../../../../../apps/electron/src/renderer/pages/notes/NoteLibraryChrome.tsx) | [apps/electron/src/renderer/pages/NotesPage.tsx](../../../../../../apps/electron/src/renderer/pages/NotesPage.tsx) | Invokes supplied callback: onChange | react |
| [apps/electron/src/renderer/pages/notes/NotesAIMenu.tsx](../../../../../../apps/electron/src/renderer/pages/notes/NotesAIMenu.tsx) | [apps/electron/src/renderer/pages/NotesPage.tsx](../../../../../../apps/electron/src/renderer/pages/NotesPage.tsx) | Invokes supplied callback: onAction | react |
| [apps/electron/src/renderer/pages/notes/NotesCommentThreads.tsx](../../../../../../apps/electron/src/renderer/pages/notes/NotesCommentThreads.tsx) | [apps/electron/src/renderer/pages/NotesPage.tsx](../../../../../../apps/electron/src/renderer/pages/NotesPage.tsx) | Invokes supplied callbacks: beginCreate, endCreate, getNoteText, onClearDraft, onJumpToQuote | react |
| [apps/electron/src/renderer/pages/notes/NotesDialogs.tsx](../../../../../../apps/electron/src/renderer/pages/notes/NotesDialogs.tsx) | [apps/electron/src/renderer/pages/NotesPage.tsx](../../../../../../apps/electron/src/renderer/pages/NotesPage.tsx) | Invokes supplied callbacks: onCreateDialogOpenChange, onDeleteAsset, onDismissMissingLink, onMoveNote, onOpenAssetRenameDialog, onRenameAsset, onRenameNote | react |
| [apps/electron/src/renderer/pages/notes/NotesDocumentChrome.tsx](../../../../../../apps/electron/src/renderer/pages/notes/NotesDocumentChrome.tsx) | [apps/electron/src/renderer/pages/NotesPage.tsx](../../../../../../apps/electron/src/renderer/pages/NotesPage.tsx) | Invokes supplied callbacks: onClose, onOpenFolder, onSelect, onToggle, onWidth | react |
| [apps/electron/src/renderer/pages/notes/NotesDocumentChrome.tsx](../../../../../../apps/electron/src/renderer/pages/notes/NotesDocumentChrome.tsx) | [apps/electron/src/renderer/playground/registry/notes.tsx](../../../../../../apps/electron/src/renderer/playground/registry/notes.tsx) | Invokes supplied callbacks: onClose, onSelect | react |
| [apps/electron/src/renderer/pages/notes/NotesReadingChrome.tsx](../../../../../../apps/electron/src/renderer/pages/notes/NotesReadingChrome.tsx) | [apps/electron/src/renderer/pages/NotesPage.tsx](../../../../../../apps/electron/src/renderer/pages/NotesPage.tsx) | Invokes supplied callbacks: onActivate, onBodyChange, onCancel, onClearDraft, onCommit, onFocusHandled, onJump, onJumpToQuote, onSubmit, onToggleFold | react |
| [apps/electron/src/renderer/pages/notes/NotesReadingChrome.tsx](../../../../../../apps/electron/src/renderer/pages/notes/NotesReadingChrome.tsx) | [apps/electron/src/renderer/playground/registry/notes.tsx](../../../../../../apps/electron/src/renderer/playground/registry/notes.tsx) | Invokes supplied callbacks: onClearDraft, onJumpToQuote | react |
| [apps/electron/src/renderer/pages/notes/NotesTemplatesDialog.tsx](../../../../../../apps/electron/src/renderer/pages/notes/NotesTemplatesDialog.tsx) | [apps/electron/src/renderer/pages/NotesPage.tsx](../../../../../../apps/electron/src/renderer/pages/NotesPage.tsx) | Invokes supplied callbacks: onCreateFromTemplate, onOpenChange, onPendingReplaceHandled, onSaveAsTemplate | react |
| [apps/electron/src/renderer/pages/notes/NotesWorkspaceChrome.tsx](../../../../../../apps/electron/src/renderer/pages/notes/NotesWorkspaceChrome.tsx) | [apps/electron/src/renderer/pages/NotesPage.tsx](../../../../../../apps/electron/src/renderer/pages/NotesPage.tsx) | Invokes supplied callbacks: onClose, onCollapse | react |
| [apps/electron/src/renderer/pages/notes/VaultInsightsPanel.tsx](../../../../../../apps/electron/src/renderer/pages/notes/VaultInsightsPanel.tsx) | [apps/electron/src/renderer/playground/registry/notes.tsx](../../../../../../apps/electron/src/renderer/playground/registry/notes.tsx) | Invokes supplied callbacks: onApplyLink, onApplyMerge, onJumpFootnote, onUndoMerge, onUpdateFootnote | react |
| [apps/electron/src/renderer/pages/notes/VersionHistoryPanel.tsx](../../../../../../apps/electron/src/renderer/pages/notes/VersionHistoryPanel.tsx) | [apps/electron/src/renderer/pages/NotesPage.tsx](../../../../../../apps/electron/src/renderer/pages/NotesPage.tsx) | Invokes supplied callback: onRestore | react |
