import { memo, useMemo, useRef, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Session } from "@chat-scope/api";
import { Star } from "lucide-react";
import { formatTime } from "../utils";

interface IndexStatus {
  state: "idle" | "indexing" | "ready" | "error";
  progress: {
    totalSessions: number;
    indexedSessions: number;
    totalProviders: number;
    completedProviders: number;
    currentProvider?: "claude" | "codex" | "opencode" | "cursor";
  };
  counts: {
    claude: number;
    codex: number;
    opencode: number;
    cursor: number;
    total: number;
  };
  lastRefreshAt?: number;
  lastError?: string;
}

interface SessionListProps {
  sessions: Session[];
  favoriteSessionIds: Set<string>;
  search: string;
  searching?: boolean;
  onSearchChange: (value: string) => void;
  searchHitsBySessionId: Record<string, number>;
  indexStatus: IndexStatus;
  onRefreshIndex: () => void | Promise<void>;
  selectedSession: string | null;
  onSelectSession: (sessionId: string) => void;
  onToggleFavoriteSession: (sessionId: string) => void;
  loading?: boolean;
  filterContextNote?: string | null;
}

interface SessionRowProps {
  session: Session;
  isSelected: boolean;
  isFavorite: boolean;
  hitCount: number;
  search: string;
  onSelectSession: (sessionId: string) => void;
  onToggleFavoriteSession: (sessionId: string) => void;
  style?: CSSProperties;
  dataIndex?: number;
  measureElement?: (element: HTMLDivElement | null) => void;
  showTopBorder?: boolean;
}

function SessionRow(props: SessionRowProps) {
  const {
    session,
    isSelected,
    isFavorite,
    hitCount,
    search,
    onSelectSession,
    onToggleFavoriteSession,
    style,
    dataIndex,
    measureElement,
    showTopBorder,
  } = props;

  return (
    <div
      data-index={dataIndex}
      ref={measureElement}
      style={style}
      className={`overflow-hidden border-b border-[var(--brand-border)]/40 ${
        isSelected
          ? "bg-[var(--brand-primary)]/14"
          : "hover:bg-[var(--brand-bg-tertiary)]/65"
      } ${showTopBorder ? "border-t border-t-[var(--brand-border)]/40" : ""}`}
    >
      <div className="flex items-start gap-2 px-3 py-3.5">
        <button
          onClick={() => onSelectSession(session.id)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="text-[10px] text-[var(--brand-highlight)]/85 font-medium uppercase tracking-wide">
                {session.provider}
              </span>
              <span className="text-[10px] text-[var(--brand-text-muted)] font-medium truncate">
                {session.projectName}
              </span>
            </div>
            <span className="shrink-0 text-[10px] text-[var(--brand-text-muted)]">
              {formatTime(session.timestamp)}
            </span>
          </div>
          {search.trim().length > 0 && hitCount > 0 && (
            <div className="mb-1">
              <span className="inline-flex rounded-md border border-[var(--brand-primary)]/40 bg-[var(--brand-primary)]/18 px-1.5 py-0.5 text-[10px] text-[var(--brand-highlight)]">
                {hitCount} hit{hitCount !== 1 ? "s" : ""}
              </span>
            </div>
          )}
          <p className="text-[12px] text-[var(--brand-text-secondary)] leading-snug line-clamp-2 break-words">
            {session.display}
          </p>
        </button>

        <button
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleFavoriteSession(session.id);
          }}
          className={`mt-0.5 shrink-0 rounded-[8px] border px-2 py-1.5 transition-colors ${
            isFavorite
              ? "border-[var(--brand-primary)]/45 bg-[var(--brand-primary)]/12 text-[var(--brand-highlight)]"
              : "border-[var(--brand-border-soft)] text-[var(--brand-text-muted)] hover:bg-[var(--brand-bg-tertiary)] hover:text-[var(--brand-text-secondary)]"
          }`}
          aria-label={
            isFavorite
              ? "Remove session from favorites"
              : "Add session to favorites"
          }
          title={isFavorite ? "Remove favorite" : "Add favorite"}
        >
          <Star className={`h-3.5 w-3.5 ${isFavorite ? "fill-current" : ""}`} />
        </button>
      </div>
    </div>
  );
}

const SessionList = memo(function SessionList(props: SessionListProps) {
  const {
    sessions,
    favoriteSessionIds,
    search,
    searching,
    onSearchChange,
    searchHitsBySessionId,
    indexStatus,
    onRefreshIndex,
    selectedSession,
    onSelectSession,
    onToggleFavoriteSession,
    loading,
    filterContextNote,
  } = props;
  const parentRef = useRef<HTMLDivElement>(null);

  const favoriteSessions = useMemo(
    () => sessions.filter((session) => favoriteSessionIds.has(session.id)),
    [favoriteSessionIds, sessions],
  );
  const remainingSessions = useMemo(
    () => sessions.filter((session) => !favoriteSessionIds.has(session.id)),
    [favoriteSessionIds, sessions],
  );

  const virtualizer = useVirtualizer({
    count: remainingSessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 76,
    overscan: 10,
    measureElement: (element) => element.getBoundingClientRect().height,
  });

  return (
    <div className="h-full overflow-hidden bg-[var(--brand-bg-secondary)]/40 flex flex-col">
      <div className="px-3 py-3 border-b border-[var(--brand-border)]/80">
        <div className="flex items-center gap-2 text-[var(--brand-text-muted)] rounded-[10px] border border-[var(--brand-border-soft)] bg-[var(--brand-bg-tertiary)]/70 px-3 py-2">
          <svg
            className="w-4 h-4 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search..."
            className="flex-1 bg-transparent text-sm text-[var(--brand-text-primary)] placeholder:text-[var(--brand-text-muted)] focus:outline-none"
          />
          {search && (
            <button
              onClick={() => onSearchChange("")}
              aria-label="Clear session search"
              className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text-secondary)] transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
          {searching && (
            <svg
              className="w-4 h-4 text-[var(--brand-primary)] animate-spin"
              fill="none"
              viewBox="0 0 24 24"
              aria-label="Searching"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          )}
        </div>
      </div>

      <div className="px-3 py-3 border-b border-[var(--brand-border)]/80 bg-[var(--brand-bg-secondary)]/90">
        {filterContextNote && (
          <div className="mb-2 rounded-[8px] border border-[var(--brand-border-soft)] bg-[var(--brand-bg-tertiary)]/55 px-2.5 py-1.5 text-[10px] text-[var(--brand-text-muted)]">
            {filterContextNote}
          </div>
        )}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--brand-text-muted)]">
              Index Status
            </div>
            <div className="text-xs text-[var(--brand-text-secondary)] mt-0.5">
              {indexStatus.state === "indexing"
                ? `Indexing ${indexStatus.progress.indexedSessions}/${indexStatus.progress.totalSessions}`
                : indexStatus.state === "ready"
                  ? `Ready (${indexStatus.counts.total} sessions)`
                  : indexStatus.state === "error"
                    ? "Error"
                    : "Idle"}
            </div>
            {indexStatus.state === "indexing" && (
              <div className="text-[10px] text-[var(--brand-highlight)]/90 mt-1">
                {indexStatus.progress.currentProvider
                  ? `Provider: ${indexStatus.progress.currentProvider}`
                  : "Preparing..."}
              </div>
            )}
            {indexStatus.state === "error" && indexStatus.lastError && (
              <div
                className="text-[10px] text-[var(--brand-danger)] mt-1 truncate"
                title={indexStatus.lastError}
              >
                {indexStatus.lastError}
              </div>
            )}
            {indexStatus.lastRefreshAt && (
              <div className="text-[10px] text-[var(--brand-text-muted)] mt-1">
                Updated {formatTime(indexStatus.lastRefreshAt)}
              </div>
            )}
          </div>

          <button
            onClick={() => {
              void onRefreshIndex();
            }}
            disabled={indexStatus.state === "indexing"}
            className="shrink-0 rounded-[10px] border border-[var(--brand-border-soft)] px-2.5 py-1 text-[10px] uppercase tracking-wide text-[var(--brand-text-secondary)] hover:bg-[var(--brand-bg-tertiary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {favoriteSessions.length > 0 && (
        <div className="border-b border-[var(--brand-border)]/80 bg-[var(--brand-bg-secondary)]/88 px-3 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Star className="h-3.5 w-3.5 fill-current text-[var(--brand-highlight)]" />
              <div className="text-[10px] uppercase tracking-wide text-[var(--brand-text-muted)]">
                Favorite Sessions
              </div>
            </div>
            <div className="text-[10px] text-[var(--brand-text-muted)]">
              {favoriteSessions.length} starred
            </div>
          </div>

          <div className="max-h-56 overflow-y-auto rounded-[10px] border border-[var(--brand-border-soft)] bg-[var(--brand-bg-tertiary)]/35">
            {favoriteSessions.map((session, index) => (
              <SessionRow
                key={session.id}
                session={session}
                isSelected={selectedSession === session.id}
                isFavorite={favoriteSessionIds.has(session.id)}
                hitCount={searchHitsBySessionId[session.id] ?? 0}
                search={search}
                onSelectSession={onSelectSession}
                onToggleFavoriteSession={onToggleFavoriteSession}
                showTopBorder={index === 0}
              />
            ))}
          </div>
        </div>
      )}

      <div ref={parentRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <svg
              className="w-5 h-5 text-[var(--brand-primary)] animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </div>
        ) : sessions.length === 0 ? (
          <p className="py-8 text-center text-xs text-[var(--brand-text-muted)]">
            {search ? "No sessions match" : "No sessions found"}
          </p>
        ) : remainingSessions.length === 0 ? (
          <p className="py-8 text-center text-xs text-[var(--brand-text-muted)]">
            All visible sessions are in favorites.
          </p>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const session = remainingSessions[virtualItem.index];
              return (
                <SessionRow
                  key={session.id}
                  dataIndex={virtualItem.index}
                  measureElement={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                  session={session}
                  isSelected={selectedSession === session.id}
                  isFavorite={favoriteSessionIds.has(session.id)}
                  hitCount={searchHitsBySessionId[session.id] ?? 0}
                  search={search}
                  onSelectSession={onSelectSession}
                  onToggleFavoriteSession={onToggleFavoriteSession}
                  showTopBorder={virtualItem.index === 0}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-[var(--brand-border)]/70">
        <div className="text-[10px] text-[var(--brand-text-muted)] text-center">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""}
        </div>
      </div>
    </div>
  );
});

export default SessionList;
