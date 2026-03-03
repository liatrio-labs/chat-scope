# Chat Scope

Search and explore local AI coding assistant session history across providers in a fast web UI.

## Quick Start

Run directly from GitHub (no npm publish required):

```bash
npx --yes --package=github:liatrio-labs/chat-scope -- chat-scope
```

Run a specific branch:

```bash
npx --yes --package=github:liatrio-labs/chat-scope#<branch> -- chat-scope
```

Run from a local clone:

```bash
npx .
```

## Features

- Aggregate local history from Claude, Codex, OpenCode, and Cursor.
- Search indexed transcript content across providers.
- Filter by provider and project to narrow results quickly.
- Inspect full conversations with tool-call rendering and match navigation.
- Built for cross-tool transcript search, not single-provider session browsing.
- Keeps your data local by reading provider files and local storage.

## Supported Providers

- Claude
- Codex
- OpenCode
- Cursor

## CLI

```bash
chat-scope --help
```

```text
Usage: chat-scope [options]

Search and explore local AI session history across providers

Options:
  -V, --version              output the version number
  -p, --port <number>        Port to listen on (default: "12001")
  --dev                      Enable CORS for development
  --no-open                  Do not open browser automatically
  -h, --help                 display help for command
```


## Requirements

- Node.js 20+
- At least one supported provider with local session history

## Development

```bash
git clone https://github.com/liatrio-labs/chat-scope.git
cd chat-scope
pnpm install
pnpm dev
pnpm build
```

## Attribution

Chat Scope is based on [claude-run](https://github.com/kamranahmedse/claude-run), licensed under MIT. See `THIRD_PARTY_NOTICES.md` for full attribution details.

## License

MIT © Kamran Ahmed and contributors, Liatrio Labs contributors
