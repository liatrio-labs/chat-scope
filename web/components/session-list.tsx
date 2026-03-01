import { memo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Session } from "@claude-run/api";
import { formatTime } from "../utils";

interface IndexStatus {
  state: "idle" | "indexing" | "ready" | "error";
  progress: {
    totalSessions: number;
    indexedSessions: number;
    totalProviders: number;
    completedProviders: number;
    currentProvider?: "claude" | "codex" | "opencode";
  };
  counts: {
    claude: number;
    codex: number;
    opencode: number;
    total: number;
  };
  lastRefreshAt?: number;
  lastError?: string;
}

interface SessionListProps {
  sessions: Session[];
  search: string;
  searching?: boolean;
  onSearchChange: (value: string) => void;
  indexStatus: IndexStatus;
  onRefreshIndex: () => void | Promise<void>;
  selectedSession: string | null;
  onSelectSession: (sessionId: string) => void;
  loading?: boolean;
}

const SessionList = memo(function SessionList(props: SessionListProps) {
  const {
    sessions,
    search,
    searching,
    onSearchChange,
    indexStatus,
    onRefreshIndex,
    selectedSession,
    onSelectSession,
    loading,
  } = props;
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 76,
    overscan: 10,
    measureElement: (element) => element.getBoundingClientRect().height,
  });

  return (
    <div className="h-full overflow-hidden bg-zinc-950 flex flex-col">
      <div className="px-3 py-2 border-b border-zinc-800/60">
        <div className="flex items-center gap-2 text-zinc-500">
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
            className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none"
          />
          {search && (
            <button
              onClick={() => onSearchChange("")}
              className="text-zinc-600 hover:text-zinc-400 transition-colors"
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
              className="w-4 h-4 text-zinc-500 animate-spin"
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

      <div className="px-3 py-2 border-b border-zinc-800/60 bg-zinc-950/90">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">
              Index Status
            </div>
            <div className="text-xs text-zinc-300 mt-0.5">
              {indexStatus.state === "indexing"
                ? `Indexing ${indexStatus.progress.indexedSessions}/${indexStatus.progress.totalSessions}`
                : indexStatus.state === "ready"
                  ? `Ready (${indexStatus.counts.total} sessions)`
                  : indexStatus.state === "error"
                    ? "Error"
                    : "Idle"}
            </div>
            {indexStatus.state === "indexing" && (
              <div className="text-[10px] text-zinc-500 mt-1">
                {indexStatus.progress.currentProvider
                  ? `Provider: ${indexStatus.progress.currentProvider}`
                  : "Preparing..."}
              </div>
            )}
            {indexStatus.state === "error" && indexStatus.lastError && (
              <div
                className="text-[10px] text-rose-400 mt-1 truncate"
                title={indexStatus.lastError}
              >
                {indexStatus.lastError}
              </div>
            )}
            {indexStatus.lastRefreshAt && (
              <div className="text-[10px] text-zinc-600 mt-1">
                Updated {formatTime(indexStatus.lastRefreshAt)}
              </div>
            )}
          </div>

          <button
            onClick={() => {
              void onRefreshIndex();
            }}
            disabled={indexStatus.state === "indexing"}
            className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-300 hover:bg-zinc-800/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <div ref={parentRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <svg
              className="w-5 h-5 text-zinc-600 animate-spin"
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
          <p className="py-8 text-center text-xs text-zinc-600">
            {search ? "No sessions match" : "No sessions found"}
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
              const session = sessions[virtualItem.index];
              return (
                <button
                  key={session.id}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  onClick={() => onSelectSession(session.id)}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                  className={`px-3 py-3.5 text-left transition-colors overflow-hidden border-b border-zinc-800/40 ${
                    selectedSession === session.id
                      ? "bg-cyan-700/30"
                      : "hover:bg-zinc-900/60"
                  } ${virtualItem.index === 0 ? "border-t border-t-zinc-800/40" : ""}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wide">
                        {session.provider}
                      </span>
                      <span className="text-[10px] text-zinc-500 font-medium truncate">
                        {session.projectName}
                      </span>
                    </div>
                    <span className="text-[10px] text-zinc-600">
                      {formatTime(session.timestamp)}
                    </span>
                  </div>
                  <p className="text-[12px] text-zinc-300 leading-snug line-clamp-2 break-words">
                    {session.display}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-zinc-800/60">
        <div className="text-[10px] text-zinc-600 text-center">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""}
        </div>
      </div>
    </div>
  );
});

export default SessionList;
