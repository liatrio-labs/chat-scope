# Update Plan

## Summary

This document captures the work completed in the last five commits and the key decisions and outcomes from this conversation thread.

As of 2026-03-01, the app has moved from Claude-only history browsing to multi-provider support (Claude, Codex, OpenCode), transcript-aware search, and improved search UX.

## Last 5 Commits

## 1) `0d6e9df` (2026-03-01)

**Commit:** `fix(search): show progress and highlight transcript matches`

**Files changed:**

- `web/app.tsx`
- `web/components/session-list.tsx`
- `web/components/session-view.tsx`

**What changed:**

- Added explicit search-in-progress indicator in the sidebar.
- Added transcript highlight behavior for active search terms in opened conversations.

**Impact:**

- Users now get immediate visual feedback during search execution.
- Search hits are visible inside transcript content.

## 2) `d0aa99d` (2026-03-01)

**Commit:** `chore: ignore temp directory`

**Files changed:**

- `.gitignore`

**What changed:**

- Added ignore rule for temp output.

**Impact:**

- Keeps generated or local scratch artifacts out of version control noise.

## 3) `4d52a9c` (2026-03-01)

**Commit:** `feat(search): support transcript text search across providers`

**Files changed:**

- `api/server.ts`
- `api/storage.ts`
- `web/app.tsx`
- `web/components/session-list.tsx`

**What changed:**

- Added backend search endpoint usage for session search.
- Added transcript-aware search logic across provider data.
- Wired UI search input to backend session search flow.

**Impact:**

- Users can now find sessions by transcript content, not just session title/project metadata.
- Resolved the specific issue where known Codex content existed but was not discoverable from the UI.

## 4) `bb381db` (2026-03-01)

**Commit:** `feat(web): add provider filtering and multi-source sessions`

**Files changed:**

- `web/app.tsx`
- `web/components/session-list.tsx`
- `web/components/session-view.tsx`
- `web/hooks/use-event-source.ts`

**What changed:**

- Added provider filter UI (`all`, `claude`, `codex`, `opencode`).
- Added provider badges/labels in session list and header.
- Added provider-aware conversation loading strategy:
  - Claude uses SSE streaming.
  - Codex/OpenCode use static fetch.
- Scoped EventSource usage so it can be disabled when not needed.

**Impact:**

- Frontend now supports multiple session sources while preserving Claude live behavior.

## 5) `7d8c067` (2026-03-01)

**Commit:** `feat(api): add Codex and OpenCode session providers`

**Files changed:**

- `api/server.ts`
- `api/storage.ts`

**What changed:**

- Added provider-aware session model and composite IDs (`provider:sourceId`).
- Implemented Codex and OpenCode storage readers/parsers.
- Added provider query support for sessions/projects endpoints.
- Guarded streaming endpoint to Claude sessions only.

**Impact:**

- Backend now natively supports session history ingestion from Codex and OpenCode in addition to Claude.

## Conversation Timeline and Outcomes

## Early context and direction

- Requested full app analysis and support expansion beyond Claude.
- Researched and validated local storage mechanisms for Cursor, Codex, and OpenCode.
- Chosen implementation order prioritized Codex + OpenCode first.

## Phase 1 implementation delivered

- Implemented backend multi-provider ingestion and normalization.
- Implemented frontend provider filter and provider-specific conversation loading.
- Committed incrementally as requested.

## Search discoverability issue reported and fixed

- User provided a concrete missing-result example from Codex transcript content.
- Root cause identified: list search matched only metadata, not transcript body.
- Implemented transcript-aware search endpoint and UI integration.

## Search UX bugs reported and fixed

- Added search progress indicator.
- Added search term highlighting within transcript content.

## Planning work completed in-thread

- Produced a decision-complete plan for next search/indexing iteration:
  - immediate list clear on search start,
  - index status + refresh controls,
  - transcript hit navigation with `current/total` and prev/next.

## Documentation created in this thread (not part of the five commits above)

- `docs/ARCHITECTURE.md`
- `docs/SEARCH-INDEXING-IMPLEMENTATION-PLAN.md`

Both files include Mermaid diagrams and were validated with `mmdc`.

## Current Status Snapshot

Completed:

- Multi-provider support for Claude, Codex, OpenCode.
- Provider filter and provider-aware conversation loading.
- Transcript-aware session search.
- Search progress indication and transcript term highlighting.
- Architecture and implementation-plan docs with validated diagrams.

Planned next (from approved plan):

- Clear list immediately when search starts (strict result-state behavior).
- Add explicit indexing status and refresh UI/API.
- Add in-transcript hit navigation controls and total match counter.

## Phase 2 Plan: Cursor Conversation Search Support

Recovered from the 2026-03-01 planning session (`rollout-2026-03-01T14-41-40-019caaeb-b5f9-7c42-8f8c-25042f1bb359.jsonl`), Cursor was explicitly deferred to a follow-up phase after Codex/OpenCode.

### Scope (Phase 2)

- Add Cursor as a new provider focused on browse + search parity (no streaming or resume parity in the first Cursor cut).
- Keep Claude/Codex/OpenCode behavior unchanged and backward-compatible.
- Integrate Cursor results into the same provider-filtered list and transcript search/index pipeline.

### Planned Cursor Data Sources

- Primary source (preferred): `~/.cursor/projects/*/agent-transcripts/<uuid>/<uuid>.jsonl`
  - Observed line shape: `{"role":"user|assistant","message":{"content":[...]}}`
  - Supports straightforward transcript extraction for search/highlight.
- Secondary/legacy source (optional fallback): `~/.cursor/chats/*/*/store.db`
  - SQLite tables observed: `blobs`, `meta`
  - Requires extra decoding logic and stronger schema guardrails.

### Implementation Notes Captured in Plan

- Add a Cursor adapter in the provider abstraction (same slot used for Claude/Codex/OpenCode adapters).
- Use composite IDs (`cursor:<providerSessionId>`) to avoid collisions.
- Derive display/project metadata from transcript path/workspace mapping where available.
- Feed Cursor transcript text into indexed search with the same case-insensitive behavior used by other providers.
- Apply schema/version hardening:
  - tolerate malformed/missing files,
  - skip unreadable records,
  - do not fail server startup if Cursor storage is absent.

### Delivery Split from Prior Plan

- Phase 1 PR: provider abstraction + Codex/OpenCode shipped (completed).
- Phase 2 PR: Cursor adapter + transcript search integration + fallback behavior for legacy Cursor storage.
