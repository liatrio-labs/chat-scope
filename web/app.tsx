import { useState, useEffect, useCallback, useMemo } from "react";
import type { Session, SessionProvider } from "@chat-scope/api";
import { PanelLeft, Copy, Check } from "lucide-react";
import { formatTime } from "./utils";
import SessionList from "./components/session-list";
import SessionView from "./components/session-view";
import { useEventSource } from "./hooks/use-event-source";

interface SessionHeaderProps {
  session: Session;
  copied: boolean;
  showTranscriptPath: boolean;
  onCopyResumeCommand: (sourceId: string, projectPath: string) => void;
}

function SessionHeader(props: SessionHeaderProps) {
  const { session, copied, showTranscriptPath, onCopyResumeCommand } = props;

  return (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm text-[var(--brand-text-primary)] truncate max-w-xs font-medium">
            {session.display}
          </span>
          <span className="text-xs text-[var(--brand-highlight)]/80 shrink-0 uppercase tracking-wide">
            {session.provider}
          </span>
          <span className="text-xs text-[var(--brand-text-muted)] shrink-0">
            {session.projectName}
          </span>
          <span className="text-xs text-[var(--brand-text-muted)] shrink-0">
            {formatTime(session.timestamp)}
          </span>
        </div>
        {showTranscriptPath && (
          <div
            className="mt-1 text-[11px] text-[var(--brand-text-muted)] truncate font-mono"
            title={session.transcriptPath || "Path unavailable"}
          >
            {session.transcriptPath || "Path unavailable"}
          </div>
        )}
      </div>
      {session.canResume && (
        <button
          onClick={() => onCopyResumeCommand(session.sourceId, session.project)}
          className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-[#0b2210] bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] rounded-[10px] transition-colors cursor-pointer shrink-0"
          title="Copy resume command to clipboard"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-[#0b2210]" />
              <span className="text-[#0b2210] font-semibold">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-[#0b2210]" />
              <span>Copy Resume Command</span>
            </>
          )}
        </button>
      )}
    </>
  );
}

type ProviderFilter = SessionProvider | "all";
const SEARCH_QUERY_PARAM = "q";

function getInitialSearchQuery(): string {
  if (typeof window === "undefined") {
    return "";
  }

  return (
    new URLSearchParams(window.location.search).get(SEARCH_QUERY_PARAM) || ""
  );
}

function syncSearchQueryParam(query: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  const normalizedQuery = query.trim();

  if (normalizedQuery) {
    url.searchParams.set(SEARCH_QUERY_PARAM, normalizedQuery);
  } else {
    url.searchParams.delete(SEARCH_QUERY_PARAM);
  }

  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(null, "", nextUrl);
}

interface IndexStatus {
  state: "idle" | "indexing" | "ready" | "error";
  progress: {
    totalSessions: number;
    indexedSessions: number;
    totalProviders: number;
    completedProviders: number;
    currentProvider?: SessionProvider;
  };
  counts: {
    claude: number;
    codex: number;
    opencode: number;
    cursor: number;
    total: number;
  };
  startedAt?: number;
  completedAt?: number;
  lastRefreshAt?: number;
  lastError?: string;
  generation: number;
}

interface SessionSearchResponse {
  sessions: Session[];
  hitsBySessionId: Record<string, number>;
  status: IndexStatus;
  query: string;
}

const DEFAULT_INDEX_STATUS: IndexStatus = {
  state: "idle",
  progress: {
    totalSessions: 0,
    indexedSessions: 0,
    totalProviders: 4,
    completedProviders: 0,
  },
  counts: {
    claude: 0,
    codex: 0,
    opencode: 0,
    cursor: 0,
    total: 0,
  },
  generation: 0,
};

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [searchResults, setSearchResults] = useState<Session[] | null>(null);
  const [searchHitsBySessionId, setSearchHitsBySessionId] = useState<
    Record<string, number>
  >({});
  const [searchQuery, setSearchQuery] = useState(getInitialSearchQuery);
  const [searching, setSearching] = useState(false);
  const [indexStatus, setIndexStatus] =
    useState<IndexStatus>(DEFAULT_INDEX_STATUS);
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedProvider, setSelectedProvider] =
    useState<ProviderFilter>("all");
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyResumeCommand = useCallback(
    (sessionId: string, projectPath: string) => {
      const command = `cd ${projectPath} && claude --resume ${sessionId}`;
      navigator.clipboard.writeText(command).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    },
    [],
  );

  const selectedSessionData = useMemo(() => {
    if (!selectedSession) {
      return null;
    }

    return sessions.find((s) => s.id === selectedSession) || null;
  }, [sessions, selectedSession]);

  const fetchProjects = useCallback((provider: ProviderFilter) => {
    fetch(`/api/projects?provider=${provider}`)
      .then((res) => res.json())
      .then(setProjects)
      .catch(console.error);
  }, []);

  const fetchIndexStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/index/status");
      if (!response.ok) {
        return null;
      }
      const status = (await response.json()) as IndexStatus;
      setIndexStatus(status);
      return status;
    } catch {
      return null;
    }
  }, []);

  const runSearch = useCallback(
    async (query: string, provider: ProviderFilter, signal?: AbortSignal) => {
      const response = await fetch(
        `/api/sessions/search?provider=${provider}&query=${encodeURIComponent(query)}`,
        { signal },
      );

      if (!response.ok) {
        throw new Error(`Search failed with status ${response.status}`);
      }

      const data = (await response.json()) as SessionSearchResponse;
      setSearchResults(data.sessions);
      setSearchHitsBySessionId(data.hitsBySessionId || {});
      setIndexStatus(data.status);
    },
    [],
  );

  const triggerIndexRefresh = useCallback(async () => {
    try {
      const response = await fetch("/api/index/refresh", { method: "POST" });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as {
        status?: IndexStatus;
      };
      if (data.status) {
        setIndexStatus(data.status);
      }
    } catch {
      // Ignore refresh failures and rely on polling.
    }
  }, []);

  const fetchSessions = useCallback((provider: ProviderFilter) => {
    setLoading(true);
    setSearchResults(null);
    setSearchHitsBySessionId({});
    setSearching(false);
    fetch(`/api/sessions?provider=${provider}`)
      .then((res) => res.json())
      .then((data: Session[]) => {
        setSessions(data);
        setLoading(false);
      })
      .catch(() => {
        setSessions([]);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    setSelectedProject(null);
    fetchProjects(selectedProvider);
    fetchSessions(selectedProvider);
    fetchIndexStatus().catch(console.error);
  }, [fetchIndexStatus, fetchProjects, fetchSessions, selectedProvider]);

  useEffect(() => {
    syncSearchQueryParam(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    const normalizedQuery = searchQuery.trim();
    if (!normalizedQuery) {
      setSearchResults(null);
      setSearchHitsBySessionId({});
      setSearching(false);
      return;
    }

    setSearching(true);
    setSearchResults([]);
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      runSearch(normalizedQuery, selectedProvider, controller.signal)
        .then(() => {
          setSearching(false);
        })
        .catch((error: unknown) => {
          if ((error as { name?: string }).name === "AbortError") {
            return;
          }
          setSearchResults([]);
          setSearchHitsBySessionId({});
          setSearching(false);
        });
    }, 150);

    return () => {
      clearTimeout(timeout);
      controller.abort();
      setSearching(false);
    };
  }, [runSearch, searchQuery, selectedProvider]);

  useEffect(() => {
    let intervalMs = indexStatus.state === "indexing" ? 1000 : 5000;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let previousState = indexStatus.state;

    const poll = async () => {
      const nextStatus = await fetchIndexStatus();
      if (!nextStatus) {
        return;
      }

      const activeQuery = searchQuery.trim();
      if (
        previousState === "indexing" &&
        nextStatus.state === "ready" &&
        activeQuery.length > 0
      ) {
        setSearching(true);
        try {
          await runSearch(activeQuery, selectedProvider);
        } catch {
          setSearchResults([]);
        } finally {
          setSearching(false);
        }
      }

      previousState = nextStatus.state;

      const nextInterval = nextStatus.state === "indexing" ? 1000 : 5000;
      if (nextInterval !== intervalMs) {
        intervalMs = nextInterval;
        if (intervalId) {
          clearInterval(intervalId);
        }
        intervalId = setInterval(() => {
          poll().catch(console.error);
        }, intervalMs);
      }
    };

    intervalId = setInterval(() => {
      poll().catch(console.error);
    }, intervalMs);

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [
    fetchIndexStatus,
    indexStatus.state,
    runSearch,
    searchQuery,
    selectedProvider,
  ]);

  const handleSessionsFull = useCallback((event: MessageEvent) => {
    const data: Session[] = JSON.parse(event.data);
    setSessions((prev) => {
      const nonClaudeSessions = prev.filter(
        (session) => session.provider !== "claude",
      );
      return [...nonClaudeSessions, ...data].sort(
        (a, b) => b.timestamp - a.timestamp,
      );
    });
  }, []);

  const handleSessionsUpdate = useCallback((event: MessageEvent) => {
    const updates: Session[] = JSON.parse(event.data);
    setSessions((prev) => {
      const sessionMap = new Map(prev.map((s) => [s.id, s]));
      for (const update of updates) {
        sessionMap.set(update.id, update);
      }
      return Array.from(sessionMap.values()).sort(
        (a, b) => b.timestamp - a.timestamp,
      );
    });
  }, []);

  const handleSessionsError = useCallback(() => {
    // Streaming failures should not blank the list; manual fetch remains source of truth.
  }, []);

  const streamUrl =
    selectedProvider === "codex" ||
    selectedProvider === "opencode" ||
    selectedProvider === "cursor"
      ? null
      : "/api/sessions/stream?provider=claude";

  useEventSource(streamUrl, {
    events: [
      { eventName: "sessions", onMessage: handleSessionsFull },
      { eventName: "sessionsUpdate", onMessage: handleSessionsUpdate },
    ],
    onError: handleSessionsError,
  });

  const filteredSessions = useMemo(() => {
    let filtered = searchResults ?? sessions;
    if (selectedProvider !== "all") {
      filtered = filtered.filter((s) => s.provider === selectedProvider);
    }

    if (selectedProject) {
      filtered = filtered.filter((s) => s.project === selectedProject);
    }

    return filtered;
  }, [searchResults, selectedProject, selectedProvider, sessions]);

  useEffect(() => {
    if (!selectedSession) {
      return;
    }
    const stillExists = filteredSessions.some(
      (session) => session.id === selectedSession,
    );
    if (!stillExists) {
      setSelectedSession(null);
    }
  }, [filteredSessions, selectedSession]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSession(sessionId);
  }, []);

  return (
    <div className="flex h-screen bg-[var(--brand-bg-primary)] text-[var(--brand-text-primary)]">
      {!sidebarCollapsed && (
        <aside className="w-80 border-r border-[var(--brand-border)]/80 flex flex-col bg-[var(--brand-bg-secondary)]/80 backdrop-blur-sm">
          <div className="border-b border-[var(--brand-border)]/80">
            <label htmlFor={"select-project"} className="block w-full px-1">
              <select
                id={"select-project"}
                value={selectedProject || ""}
                onChange={(e) => setSelectedProject(e.target.value || null)}
                className="w-full h-[52px] bg-transparent text-[var(--brand-text-secondary)] text-sm focus:outline-none cursor-pointer px-5 py-4"
              >
                <option value="">All Projects</option>
                {projects.map((project) => {
                  const name = project.split("/").pop() || project;
                  return (
                    <option key={project} value={project}>
                      {name}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>
          <div className="border-b border-[var(--brand-border)]/80">
            <label htmlFor={"select-provider"} className="block w-full px-1">
              <select
                id={"select-provider"}
                value={selectedProvider}
                onChange={(e) =>
                  setSelectedProvider(e.target.value as ProviderFilter)
                }
                className="w-full h-[44px] bg-transparent text-[var(--brand-text-secondary)] text-xs focus:outline-none cursor-pointer px-5 py-3 uppercase tracking-wide"
              >
                <option value="all">All Providers</option>
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
                <option value="opencode">OpenCode</option>
                <option value="cursor">Cursor</option>
              </select>
            </label>
          </div>
          <SessionList
            sessions={filteredSessions}
            search={searchQuery}
            searching={searching}
            onSearchChange={setSearchQuery}
            searchHitsBySessionId={searchHitsBySessionId}
            indexStatus={indexStatus}
            onRefreshIndex={triggerIndexRefresh}
            selectedSession={selectedSession}
            onSelectSession={handleSelectSession}
            loading={loading}
          />
        </aside>
      )}

      <main className="flex-1 overflow-hidden bg-[var(--brand-bg-primary)] flex flex-col">
        <div className="h-[56px] border-b border-[var(--brand-border)]/80 flex items-center px-4 gap-4 bg-[var(--brand-bg-secondary)]/50">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-2 hover:bg-[var(--brand-bg-tertiary)] rounded-[10px] transition-colors cursor-pointer"
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
          >
            <PanelLeft className="w-4 h-4 text-[var(--brand-text-secondary)]" />
          </button>
          <div className="hidden md:flex items-center gap-2 border-r border-[var(--brand-border)]/70 pr-4 mr-1">
            <img
              src="https://www.liatrio.com/brand-logos/logo_Liatrio_reverse-preferred.svg"
              alt="Liatrio"
              className="h-5 w-auto"
            />
            <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--brand-text-muted)]">
              Session Viewer
            </span>
          </div>
          {selectedSessionData && (
            <SessionHeader
              session={selectedSessionData}
              copied={copied}
              showTranscriptPath={Boolean(searchQuery.trim())}
              onCopyResumeCommand={handleCopyResumeCommand}
            />
          )}
        </div>
        <div className="flex-1 overflow-hidden">
          {selectedSession ? (
            selectedSessionData ? (
              <SessionView
                sessionId={selectedSession}
                provider={selectedSessionData.provider}
                searchQuery={searchQuery}
              />
            ) : null
          ) : (
            <div className="flex h-full items-center justify-center text-[var(--brand-text-muted)]">
              <div className="text-center">
                <div className="text-xl mb-2 text-[var(--brand-text-secondary)] font-semibold">
                  Select a session
                </div>
                <div className="text-sm text-[var(--brand-text-muted)]">
                  Choose a session from the list to view the conversation
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
