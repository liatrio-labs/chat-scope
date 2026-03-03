<div align="center">

# Chat Scope

Search and explore local AI coding assistant session history in a fast web UI

[![npm version](https://img.shields.io/npm/v/@liatrio/chat-scope.svg)](https://www.npmjs.com/package/@liatrio/chat-scope)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

<img src=".github/claude-run.gif" alt="Chat Scope Demo" width="800" />

</div>

<br />

Run the project simply by executing

```bash
npx @liatrio/chat-scope
```

The browser will open automatically at http://localhost:12001.

## Features

- **Multi-provider support** - Aggregate sessions from Claude, Codex, OpenCode, and Cursor
- **Transcript indexing and search** - Search message content across providers
- **Provider and project filters** - Narrow results quickly
- **Real-time updates** - Watch supported providers update live
- **Session navigation tools** - Jump through matches and inspect transcript details
- **Clean UI** - Familiar chat interface with collapsible tool calls

## Usage

Install globally via npm:

```bash
npm install -g @liatrio/chat-scope
```

Then run it from any directory:

```bash
chat-scope
```

The browser will open automatically at http://localhost:12001.

```bash
chat-scope [options]

Options:
  -V, --version        Show version number
  -p, --port <number>  Port to listen on (default: 12001)
  -d, --dir <path>     Claude directory (default: ~/.claude)
  --no-open            Do not open browser automatically
  -h, --help           Show help
```

## How It Works

Chat Scope reads local session and transcript history from supported providers and presents it in a web interface with:

- **Session list** - Sessions sorted by recency across providers
- **Provider filter** - Focus on a single source or search all
- **Project filter** - Narrow by workspace or project
- **Conversation view** - Full message history with tool calls
- **Index-backed search** - Fast transcript search and result navigation
- **Real-time updates** - SSE streaming for supported providers

## Requirements

- Node.js 20+
- At least one supported local provider with existing session history

## Development

```bash
# Clone the repo
git clone https://github.com/liatrio-labs/chat-scope.git
cd chat-scope

# Install dependencies
pnpm install

# Start development servers
pnpm dev

# Build for production
pnpm build
```

## Attribution

Chat Scope is based on [claude-run](https://github.com/kamranahmedse/claude-run), licensed under MIT. See `THIRD_PARTY_NOTICES.md` for attribution details.

## License

MIT © Kamran Ahmed and contributors, Liatrio Labs contributors
