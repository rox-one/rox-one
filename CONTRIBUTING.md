# Contributing to ROX

Thank you for your interest in contributing to ROX! This document provides guidelines and instructions for contributing.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) runtime - use the version pinned in `package.json` (`packageManager`); CI runs the same one
- Node.js 24+ (for some tooling)
- macOS, Linux, or Windows

### Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/rox-one/rox-one.git
   cd rox-one
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Install the git hooks (recommended):
   ```bash
   bun run hooks:install
   ```
   This points `core.hooksPath` at `.githooks/`. The `pre-commit` hook auto-fixes
   the two generators that otherwise only fail later in CI, on someone else's PR:
   `lint:i18n:sorted` (locale key order) and `ipc-inventory` (the frozen
   `RPC_CHANNELS` snapshot). It runs only when your staged diff can affect them
   and never blocks the commit. Skip this step if you prefer to run them by hand.

4. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

5. Run in development mode:
   ```bash
   bun run electron:dev
   ```

## Development Workflow

### Branch Naming

Use descriptive branch names:
- `feature/add-new-tool` - New features
- `fix/resolve-auth-issue` - Bug fixes
- `refactor/simplify-agent-loop` - Code refactoring
- `docs/update-readme` - Documentation updates

### Making Changes

1. Create a feature branch from `main`
2. Make your changes
3. Run type checking: `bun run typecheck:all`
4. Commit your changes with clear, descriptive messages
5. Push to your fork and create a pull request

Never hand-merge `bun.lock`: a partial merge leaves entries the resolver cannot
read and every CI job fails at `bun install --frozen-lockfile`. On conflict,
regenerate and prove it with the pinned bun version:

```bash
git checkout --theirs bun.lock && bun install && bun install --frozen-lockfile
```

### Code Style

- We use TypeScript throughout the codebase
- Follow existing patterns in the codebase
- Use meaningful variable and function names
- Add comments for complex logic

### Type Checking

Before submitting a PR, ensure all type checks pass:

```bash
bun run typecheck:all
```

## Pull Request Process

1. **Title**: Use a clear, descriptive title
2. **Description**: Explain what the PR does and why
3. **Testing**: Describe how you tested the changes
4. **Screenshots**: Include screenshots for UI changes

### PR Template

```markdown
## Summary
Brief description of changes

## Changes
- Change 1
- Change 2

## Testing
How you tested these changes

## Screenshots (if applicable)
```

## Project Structure

```
rox-one/
├── apps/
│   └── electron/    # Desktop GUI (primary interface)
└── packages/
    ├── core/        # @rox/core - Shared types
    ├── shared/      # @rox/shared - Business logic
    └── ui/          # @rox/ui - React components
```

## Key Areas

- **Agent Logic**: `packages/shared/src/agent/`
- **Authentication**: `packages/shared/src/auth/`
- **MCP Integration**: `packages/shared/src/mcp/`
- **UI Components**: `packages/ui/src/`
- **Electron App**: `apps/electron/`

## Questions?

- Open an issue for bugs or feature requests
- Start a discussion for questions or ideas

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
