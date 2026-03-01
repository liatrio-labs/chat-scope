import { useState, useEffect, useCallback, useMemo } from "react";
import type { Session, SessionProvider } from "@claude-run/api";
import { PanelLeft, Copy, Check } from "lucide-react";
import { formatTime } from "./utils";
import SessionList from "./components/session-list";
import SessionView from "./components/session-view";
import { useEventSource } from "./hooks/use-event-source";

interface SessionHeaderProps {
  session: Session;
  copied: boolean;
  onCopyResumeCommand: (sourceId: string, projectPath: string) => void;
}

function SessionHeader(props: SessionHeaderProps) {
  const { session, copied, onCopyResumeCommand } = props;

  return (
    <>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className="text-sm text-zinc-300 truncate max-w-xs">
          {session.display}
        </span>
        <span className="text-xs text-zinc-500 shrink-0 uppercase tracking-wide">
          {session.provider}
        </span>
        <span className="text-xs text-zinc-600 shrink-0">
          {session.projectName}
        </span>
        <span className="text-xs text-zinc-600 shrink-0">
          {formatTime(session.timestamp)}
        </span>
      </div>
      {session.canResume && (
        <button
          onClick={() => onCopyResumeCommand(session.sourceId, session.project)}
          className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors cursor-pointer shrink-0"
          title="Copy resume command to clipboard"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-green-500" />
              <span className="text-green-500">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy Resume Command</span>
            </>
          )}
        </button>
      )}
    </>
  );
}

type ProviderFilter = SessionProvider | "all";

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [searchResults, setSearchResults] = useState<Session[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderFilter>("all");
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

  const fetchSessions = useCallback((provider: ProviderFilter) => {
    setLoading(true);
    setSearchResults(null);
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
  }, [fetchProjects, fetchSessions, selectedProvider]);

  useEffect(() => {
    const normalizedQuery = searchQuery.trim();
    if (!normalizedQuery) {
      setSearchResults(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      fetch(
        `/api/sessions/search?provider=${selectedProvider}&query=${encodeURIComponent(normalizedQuery)}`,
        { signal: controller.signal },
      )
        .then((res) => res.json())
        .then((data: Session[]) => {
          setSearchResults(data);
          setSearching(false);
        })
        .catch((error: unknown) => {
          if ((error as { name?: string }).name === "AbortError") {
            return;
          }
          setSearchResults([]);
          setSearching(false);
        });
    }, 150);

    return () => {
      clearTimeout(timeout);
      controller.abort();
      setSearching(false);
    };
  }, [searchQuery, selectedProvider]);

  const handleSessionsFull = useCallback((event: MessageEvent) => {
    const data: Session[] = JSON.parse(event.data);
    setSessions((prev) => {
      const nonClaudeSessions = prev.filter((session) => session.provider !== "claude");
      return [...nonClaudeSessions, ...data].sort((a, b) => b.timestamp - a.timestamp);
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
    selectedProvider === "codex" || selectedProvider === "opencode"
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
    const stillExists = filteredSessions.some((session) => session.id === selectedSession);
    if (!stillExists) {
      setSelectedSession(null);
    }
  }, [filteredSessions, selectedSession]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSession(sessionId);
  }, []);

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      {!sidebarCollapsed && (
        <aside className="w-80 border-r border-zinc-800/60 flex flex-col bg-zinc-950">
          <div className="border-b border-zinc-800/60">
            <label htmlFor={"select-project"} className="block w-full px-1">
              <select
                id={"select-project"}
                value={selectedProject || ""}
                onChange={(e) => setSelectedProject(e.target.value || null)}
                className="w-full h-[50px] bg-transparent text-zinc-300 text-sm focus:outline-none cursor-pointer px-5 py-4"
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
          <div className="border-b border-zinc-800/60">
            <label htmlFor={"select-provider"} className="block w-full px-1">
              <select
                id={"select-provider"}
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value as ProviderFilter)}
                className="w-full h-[42px] bg-transparent text-zinc-300 text-xs focus:outline-none cursor-pointer px-5 py-3 uppercase tracking-wide"
              >
                <option value="all">All Providers</option>
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
                <option value="opencode">OpenCode</option>
              </select>
            </label>
          </div>
          <SessionList
            sessions={filteredSessions}
            search={searchQuery}
            searching={searching}
            onSearchChange={setSearchQuery}
            selectedSession={selectedSession}
            onSelectSession={handleSelectSession}
            loading={loading}
          />
        </aside>
      )}

      <main className="flex-1 overflow-hidden bg-zinc-950 flex flex-col">
        <div className="h-[50px] border-b border-zinc-800/60 flex items-center px-4 gap-4">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
          >
            <PanelLeft className="w-4 h-4 text-zinc-400" />
          </button>
          {selectedSessionData && (
            <SessionHeader
              session={selectedSessionData}
              copied={copied}
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
            <div className="flex h-full items-center justify-center text-zinc-600">
              <div className="text-center">
                <div className="text-base mb-2 text-zinc-500">
                  Select a session
                </div>
                <div className="text-sm text-zinc-600">
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
