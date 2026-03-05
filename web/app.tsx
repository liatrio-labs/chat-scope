import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { Session, SessionProvider } from "@chat-scope/api";
import {
  Copy,
  Check,
  FileDown,
  ChevronDown,
  Loader2,
  CircleCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { formatTime } from "./utils";
import SessionList from "./components/session-list";
import SessionView from "./components/session-view";
import ProjectTreePicker from "./components/project-tree-picker";
import { useEventSource } from "./hooks/use-event-source";

interface SessionHeaderProps {
  session: Session;
  showTranscriptPath: boolean;
  exportingFormat: ExportFormat | null;
  metrics: ConversationMetrics | null;
  metricsLoading: boolean;
  onExportConversation: (session: Session, format: ExportFormat) => void;
}

interface ConversationMetrics {
  turnUnits: number;
  exchangeCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  userCharacters: number;
  assistantCharacters: number;
  totalCharacters: number;
  userPercent: number;
  assistantPercent: number;
  ratioLabel: string;
  toolEventCount: number;
}

interface ResumeCommandOption {
  label: string;
  command: string;
}

function quoteShellPath(path: string): string {
  return `"${path.split('"').join('\\"')}"`;
}

function getCursorTranscriptId(sourceId: string): string {
  const separatorIndex = sourceId.indexOf(":");
  if (separatorIndex < 0) {
    return sourceId;
  }
  return sourceId.slice(separatorIndex + 1);
}

function getResumeCommands(session: Session): ResumeCommandOption[] {
  const projectPrefix = `cd ${quoteShellPath(session.project)} && `;

  if (session.provider === "claude") {
    return [
      {
        label: "Claude Resume",
        command: `${projectPrefix}claude --resume ${session.sourceId}`,
      },
      {
        label: "Claude Short Flag",
        command: `${projectPrefix}claude -r ${session.sourceId}`,
      },
    ];
  }

  if (session.provider === "codex") {
    return [
      {
        label: "Codex Resume",
        command: `${projectPrefix}codex resume ${session.sourceId}`,
      },
      {
        label: "Codex Exec Resume",
        command: `${projectPrefix}codex exec resume ${session.sourceId}`,
      },
    ];
  }

  if (session.provider === "opencode") {
    return [
      {
        label: "OpenCode Session",
        command: `${projectPrefix}opencode --session ${session.sourceId}`,
      },
      {
        label: "OpenCode Continue Last",
        command: `${projectPrefix}opencode --continue`,
      },
    ];
  }

  if (session.provider === "cursor") {
    const chatId = getCursorTranscriptId(session.sourceId);
    return [
      {
        label: "Cursor Resume",
        command: `${projectPrefix}cursor-agent --resume ${chatId}`,
      },
      {
        label: "Cursor Continue Last",
        command: `${projectPrefix}cursor-agent --continue`,
      },
      {
        label: "Open Cursor Workspace",
        command: `${projectPrefix}cursor .`,
      },
    ];
  }

  return [];
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function SessionHeader(props: SessionHeaderProps) {
  const {
    session,
    showTranscriptPath,
    exportingFormat,
    metrics,
    metricsLoading,
    onExportConversation,
  } = props;
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [resumeMenuOpen, setResumeMenuOpen] = useState(false);
  const [copiedCommandLabel, setCopiedCommandLabel] = useState<string | null>(
    null,
  );
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const resumeMenuRef = useRef<HTMLDivElement | null>(null);

  const resumeCommands = useMemo(() => getResumeCommands(session), [session]);
  const primaryResumeCommand = resumeCommands[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const outsideExportMenu = exportMenuRef.current
        ? !exportMenuRef.current.contains(target)
        : true;
      const outsideResumeMenu = resumeMenuRef.current
        ? !resumeMenuRef.current.contains(target)
        : true;

      if (outsideExportMenu && outsideResumeMenu) {
        setExportMenuOpen(false);
        setResumeMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const copyCommand = useCallback(async (label: string, command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommandLabel(label);
      setTimeout(() => {
        setCopiedCommandLabel((current) =>
          current === label ? null : current,
        );
      }, 1800);
    } catch (error) {
      console.error("Failed to copy resume command", error);
    }
  }, []);

  return (
    <div className="min-w-0 flex-1 rounded-[14px] border border-[var(--brand-border)]/70 bg-[var(--brand-bg-secondary)]/55 px-4 py-3">
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3 min-w-0">
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-[var(--brand-highlight)]/90 uppercase tracking-wide font-semibold">
                {session.provider}
              </span>
              <span className="text-xs text-[var(--brand-text-muted)]">
                Updated {formatTime(session.timestamp)}
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 shrink-0">
              {primaryResumeCommand && (
                <div className="relative flex items-center" ref={resumeMenuRef}>
                  <button
                    onClick={() =>
                      void copyCommand(
                        primaryResumeCommand.label,
                        primaryResumeCommand.command,
                      )
                    }
                    className="h-9 flex items-center gap-2 px-2.5 py-1.5 text-xs text-[var(--brand-text-primary)] border border-[var(--brand-primary)]/60 hover:bg-[var(--brand-primary)]/12 rounded-l-[10px] border-r-0 transition-colors cursor-pointer"
                    title={primaryResumeCommand.command}
                  >
                    {copiedCommandLabel === primaryResumeCommand.label ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[var(--brand-highlight)]" />
                        <span className="font-semibold text-[var(--brand-highlight)]">
                          Copied
                        </span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Resume</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setResumeMenuOpen((open) => !open);
                      setExportMenuOpen(false);
                    }}
                    className="h-9 px-2 py-1.5 text-[var(--brand-text-primary)] border border-[var(--brand-primary)]/60 hover:bg-[var(--brand-primary)]/12 rounded-r-[10px] transition-colors cursor-pointer"
                    aria-label="Show resume command options"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>

                  {resumeMenuOpen && (
                    <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-[28rem] rounded-[12px] border border-[var(--brand-border-soft)] bg-[var(--brand-bg-secondary)] p-2 shadow-[var(--brand-shadow)]">
                      {resumeCommands.map((option) => (
                        <button
                          key={option.label}
                          onClick={() => {
                            void copyCommand(option.label, option.command);
                            setResumeMenuOpen(false);
                          }}
                          className="group w-full text-left rounded-[10px] px-2.5 py-2.5 hover:bg-[var(--brand-bg-tertiary)]/90 transition-colors"
                          title={option.command}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm text-[var(--brand-text-primary)]">
                              {option.label}
                            </div>
                            <span
                              className={`inline-flex items-center gap-1 rounded-[6px] border px-1.5 py-0.5 text-[10px] transition-opacity ${
                                copiedCommandLabel === option.label
                                  ? "border-[var(--brand-primary)]/45 text-[var(--brand-highlight)] opacity-100"
                                  : "border-[var(--brand-border-soft)] text-[var(--brand-text-muted)] opacity-25 group-hover:opacity-100"
                              }`}
                            >
                              {copiedCommandLabel === option.label ? (
                                <Check className="h-3 w-3" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                              <span>
                                {copiedCommandLabel === option.label
                                  ? "Copied"
                                  : "Copy"}
                              </span>
                            </span>
                          </div>
                          <div className="mt-1.5 overflow-x-auto rounded-[8px] border border-[var(--brand-border-soft)] bg-[var(--brand-bg-tertiary)]/60 px-2 py-1.5">
                            <code className="block w-max min-w-full whitespace-nowrap text-[11px] leading-tight text-[var(--brand-text-secondary)]">
                              {option.command}
                            </code>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="relative" ref={exportMenuRef}>
                <button
                  onClick={() => {
                    setExportMenuOpen((open) => !open);
                    setResumeMenuOpen(false);
                  }}
                  disabled={Boolean(exportingFormat)}
                  className="h-9 flex items-center gap-2 px-2.5 py-1.5 text-xs text-[var(--brand-text-secondary)] border border-[var(--brand-border-soft)] hover:bg-[var(--brand-bg-tertiary)] rounded-[10px] transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {exportingFormat ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FileDown className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {exportingFormat
                      ? `Exporting ${exportingFormat.toUpperCase()}...`
                      : "Export"}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>

                {exportMenuOpen && !exportingFormat && (
                  <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-40 rounded-[10px] border border-[var(--brand-border-soft)] bg-[var(--brand-bg-secondary)] p-1 shadow-[var(--brand-shadow)]">
                    {(["markdown", "html", "pdf"] as ExportFormat[]).map(
                      (format) => (
                        <button
                          key={format}
                          onClick={() => {
                            onExportConversation(session, format);
                            setExportMenuOpen(false);
                          }}
                          className="w-full text-left rounded-[8px] px-2.5 py-2 text-xs text-[var(--brand-text-primary)] hover:bg-[var(--brand-bg-tertiary)]/90 transition-colors"
                        >
                          Export as {format.toUpperCase()}
                        </button>
                      ),
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-2 text-base text-[var(--brand-text-primary)] truncate font-semibold">
            {session.display}
          </div>
          <div
            className="mt-1 text-[11px] text-[var(--brand-text-muted)] font-mono break-all"
            title={session.project}
          >
            Project Path: {session.project}
          </div>
          {showTranscriptPath && (
            <div
              className="mt-1 text-[11px] text-[var(--brand-text-muted)] truncate font-mono"
              title={session.transcriptPath || "Path unavailable"}
            >
              Transcript: {session.transcriptPath || "Path unavailable"}
            </div>
          )}
        </div>

        <div className="min-h-[30px] flex flex-wrap items-center gap-2 text-[11px]">
          {metricsLoading && (
            <span className="rounded-full border border-[var(--brand-border-soft)] bg-[var(--brand-bg-tertiary)]/70 px-2.5 py-1 text-[var(--brand-text-muted)]">
              Calculating metrics...
            </span>
          )}
          {!metricsLoading && metrics && (
            <>
              <span className="rounded-full border border-[var(--brand-border-soft)] bg-[var(--brand-bg-tertiary)]/70 px-2.5 py-1 text-[var(--brand-text-secondary)]">
                Turns {formatCount(metrics.turnUnits)} (
                {formatCount(metrics.exchangeCount)} exchanges)
              </span>
              <span className="rounded-full border border-[var(--brand-border-soft)] bg-[var(--brand-bg-tertiary)]/70 px-2.5 py-1 text-[var(--brand-text-secondary)]">
                User chars {formatCount(metrics.userCharacters)}
              </span>
              <span className="rounded-full border border-[var(--brand-border-soft)] bg-[var(--brand-bg-tertiary)]/70 px-2.5 py-1 text-[var(--brand-text-secondary)]">
                AI chars {formatCount(metrics.assistantCharacters)}
              </span>
              <span className="rounded-full border border-[var(--brand-primary)]/45 bg-[var(--brand-primary)]/12 px-2.5 py-1 text-[var(--brand-highlight)]">
                User {metrics.userPercent}% / AI {metrics.assistantPercent}%
              </span>
              <span className="rounded-full border border-[var(--brand-border-soft)] bg-[var(--brand-bg-tertiary)]/70 px-2.5 py-1 text-[var(--brand-text-secondary)]">
                Ratio {metrics.ratioLabel}
              </span>
              <span className="rounded-full border border-[var(--brand-border-soft)] bg-[var(--brand-bg-tertiary)]/70 px-2.5 py-1 text-[var(--brand-text-secondary)]">
                Tool events {formatCount(metrics.toolEventCount)}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type ProviderFilter = SessionProvider | "all";
type ExportFormat = "markdown" | "html" | "pdf";
const SEARCH_QUERY_PARAM = "q";

function getFileNameFromDisposition(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/filename="([^"]+)"/i);
  if (!match?.[1]) {
    return null;
  }

  return match[1];
}

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
  const [sessionMetrics, setSessionMetrics] =
    useState<ConversationMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(
    null,
  );
  const [projectTreeSearchState, setProjectTreeSearchState] = useState<{
    query: string;
    hasMatches: boolean;
    matchCount: number;
  }>({
    query: "",
    hasMatches: true,
    matchCount: 0,
  });
  const [exportFeedback, setExportFeedback] = useState<{
    type: "success" | "error";
    title: string;
    detail?: string;
  } | null>(null);

  const selectedSessionData = useMemo(() => {
    if (!selectedSession) {
      return null;
    }

    return sessions.find((s) => s.id === selectedSession) || null;
  }, [sessions, selectedSession]);

  const filterContextNote = useMemo(() => {
    const activeBits: string[] = [];

    if (selectedProvider !== "all") {
      activeBits.push(`provider=${selectedProvider}`);
    }
    if (selectedProject) {
      activeBits.push(
        `project=${selectedProject.split("/").filter(Boolean).pop() || selectedProject}`,
      );
    }
    if (searchQuery.trim()) {
      activeBits.push(`search="${searchQuery.trim()}"`);
    }

    const hasProjectSearchNoMatch =
      projectTreeSearchState.query.trim().length > 0 &&
      !projectTreeSearchState.hasMatches;

    if (!hasProjectSearchNoMatch && activeBits.length === 0) {
      return null;
    }

    if (hasProjectSearchNoMatch && activeBits.length === 0) {
      return "Project search has no matches. Session list still reflects current provider and recent sessions.";
    }

    if (hasProjectSearchNoMatch) {
      return `Project search has no matches. Session list filters: ${activeBits.join(", ")}.`;
    }

    return `Session list filters: ${activeBits.join(", ")}.`;
  }, [
    projectTreeSearchState.hasMatches,
    projectTreeSearchState.query,
    searchQuery,
    selectedProject,
    selectedProvider,
  ]);

  useEffect(() => {
    if (!selectedSessionData) {
      setSessionMetrics(null);
      setMetricsLoading(false);
      return;
    }

    const controller = new AbortController();
    setMetricsLoading(true);

    fetch(
      `/api/conversation/${encodeURIComponent(selectedSessionData.id)}/metrics`,
      {
        signal: controller.signal,
      },
    )
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Metrics fetch failed with status ${res.status}`);
        }
        return res.json() as Promise<ConversationMetrics>;
      })
      .then((metrics) => {
        setSessionMetrics(metrics);
        setMetricsLoading(false);
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name === "AbortError") {
          return;
        }
        setSessionMetrics(null);
        setMetricsLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [selectedSessionData]);

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

  const handleExportConversation = useCallback(
    async (session: Session, format: ExportFormat) => {
      setExportingFormat(format);
      setExportFeedback(null);
      try {
        const response = await fetch(
          `/api/conversation/${encodeURIComponent(session.id)}/export?format=${format}`,
        );

        if (!response.ok) {
          throw new Error(`Export failed with status ${response.status}`);
        }

        const blob = await response.blob();
        const disposition = response.headers.get("Content-Disposition");
        const fileName =
          getFileNameFromDisposition(disposition) ||
          `${session.provider}-${session.sourceId}.${format === "markdown" ? "md" : format}`;
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(objectUrl);

        setExportFeedback({
          type: "success",
          title: `${format.toUpperCase()} export complete`,
          detail: fileName,
        });
      } catch (error) {
        console.error("Failed to export conversation", error);
        setExportFeedback({
          type: "error",
          title: `${format.toUpperCase()} export failed`,
          detail: "Please retry. If this keeps failing, check server logs.",
        });
      } finally {
        setExportingFormat(null);
      }
    },
    [],
  );

  useEffect(() => {
    if (!exportFeedback) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setExportFeedback(null);
    }, 3500);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [exportFeedback]);

  return (
    <div className="flex h-screen bg-[var(--brand-bg-primary)] text-[var(--brand-text-primary)]">
      <aside className="w-80 border-r border-[var(--brand-border)]/80 flex flex-col bg-[var(--brand-bg-secondary)]/80 backdrop-blur-sm">
        <div className="h-[56px] border-b border-[var(--brand-border)]/80 flex items-center px-4">
          <img
            src="/brand/liatrio-labs-horizontal-color-transparent.svg"
            alt="ChatScope"
            className="h-6 w-auto"
          />
          <span className="ml-2 text-xs uppercase tracking-[0.16em] text-[var(--brand-text-muted)]">
            ChatScope
          </span>
        </div>

        <ProjectTreePicker
          projects={projects}
          selectedProject={selectedProject}
          onSelectProject={setSelectedProject}
          onSearchStateChange={setProjectTreeSearchState}
        />

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
          filterContextNote={filterContextNote}
        />
      </aside>

      <main className="relative flex-1 overflow-hidden bg-[var(--brand-bg-primary)] flex flex-col">
        {exportFeedback && (
          <div className="pointer-events-none absolute right-4 top-20 z-40">
            <div
              role="status"
              className={`pointer-events-auto w-[min(440px,calc(100vw-2rem))] rounded-[12px] border px-3 py-2.5 text-xs shadow-[var(--brand-shadow)] backdrop-blur-sm ${
                exportFeedback.type === "success"
                  ? "border-[var(--brand-primary)]/45 bg-[var(--brand-bg-secondary)]/95 text-[var(--brand-highlight)]"
                  : "border-[var(--brand-danger)]/50 bg-[var(--brand-bg-secondary)]/95 text-[var(--brand-danger)]"
              }`}
            >
              <div className="flex items-start gap-2">
                {exportFeedback.type === "success" ? (
                  <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">
                    {exportFeedback.title}
                  </div>
                  {exportFeedback.detail && (
                    <div className="mt-1 truncate text-[11px] text-[var(--brand-text-muted)]">
                      {exportFeedback.detail}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setExportFeedback(null)}
                  className="rounded p-1 text-[var(--brand-text-muted)] hover:bg-[var(--brand-bg-tertiary)]/80 hover:text-[var(--brand-text-secondary)]"
                  aria-label="Dismiss export notification"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="border-b border-[var(--brand-border)]/80 flex items-center px-4 py-3 gap-4 bg-[var(--brand-bg-secondary)]/50">
          {selectedSessionData && (
            <SessionHeader
              session={selectedSessionData}
              showTranscriptPath={Boolean(selectedSessionData.transcriptPath)}
              exportingFormat={exportingFormat}
              metrics={sessionMetrics}
              metricsLoading={metricsLoading}
              onExportConversation={handleExportConversation}
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
