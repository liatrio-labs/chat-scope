import {
  getConversation,
  getSessions,
  getOpenCodeTranscriptSearchText,
  SESSION_PROVIDERS,
  type Session,
  type SessionProvider,
  type ConversationMessage,
} from "./storage";

export type IndexState = "idle" | "indexing" | "ready" | "error";

export interface IndexStatus {
  state: IndexState;
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

interface IndexedDocument {
  sessionId: string;
  provider: SessionProvider;
  text: string;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(fallback), timeoutMs);
    }),
  ]);
}

export interface SearchMatch {
  sessionId: string;
  hitCount: number;
}

const documents = new Map<string, IndexedDocument>();

let status: IndexStatus = {
  state: "idle",
  progress: {
    totalSessions: 0,
    indexedSessions: 0,
    totalProviders: SESSION_PROVIDERS.length,
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

let refreshPromise: Promise<void> | null = null;

function extractTextFromMessage(message: ConversationMessage): string {
  if (message.summary) {
    return message.summary;
  }

  const content = message.message?.content;
  if (!content) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

function createSearchText(
  session: Session,
  messages: ConversationMessage[],
): string {
  const metadataText = [
    session.display,
    session.projectName,
    session.project,
  ].join("\n");
  const transcriptText = messages
    .map((message) => extractTextFromMessage(message))
    .join("\n");
  return `${metadataText}\n${transcriptText}`.toLowerCase();
}

function toProviderCounts(): IndexStatus["counts"] {
  const counts: IndexStatus["counts"] = {
    claude: 0,
    codex: 0,
    opencode: 0,
    cursor: 0,
    total: 0,
  };

  for (const document of documents.values()) {
    counts[document.provider] += 1;
    counts.total += 1;
  }

  return counts;
}

async function buildIndex(generation: number): Promise<void> {
  const allSessions = await getSessions("all");
  const sessionsByProvider = new Map<SessionProvider, Session[]>();
  for (const provider of SESSION_PROVIDERS) {
    sessionsByProvider.set(
      provider,
      allSessions.filter((session) => session.provider === provider),
    );
  }

  status = {
    ...status,
    state: "indexing",
    progress: {
      totalSessions: allSessions.length,
      indexedSessions: 0,
      totalProviders: SESSION_PROVIDERS.length,
      completedProviders: 0,
    },
    counts: {
      claude: 0,
      codex: 0,
      opencode: 0,
      cursor: 0,
      total: 0,
    },
    startedAt: Date.now(),
    completedAt: undefined,
    lastError: undefined,
    generation,
  };

  const nextDocuments = new Map<string, IndexedDocument>();

  for (const provider of SESSION_PROVIDERS) {
    if (status.generation !== generation) {
      return;
    }

    status = {
      ...status,
      progress: {
        ...status.progress,
        currentProvider: provider,
      },
    };

    const providerSessions = sessionsByProvider.get(provider) ?? [];
    const concurrency = provider === "opencode" ? 8 : 2;
    let sessionIndex = 0;

    const worker = async () => {
      while (sessionIndex < providerSessions.length) {
        if (status.generation !== generation) {
          return;
        }

        const currentIndex = sessionIndex;
        sessionIndex += 1;
        const session = providerSessions[currentIndex];

        let text = "";
        if (session.provider === "opencode") {
          const openCodeText = await withTimeout(
            getOpenCodeTranscriptSearchText(session.sourceId),
            2000,
            "",
          );
          const metadataText = [
            session.display,
            session.projectName,
            session.project,
          ].join("\n");
          text = `${metadataText}\n${openCodeText ?? ""}`.toLowerCase();
        } else {
          const messages = await getConversation(session.id);
          text = createSearchText(session, messages);
        }

        nextDocuments.set(session.id, {
          sessionId: session.id,
          provider: session.provider,
          text,
        });

        status = {
          ...status,
          progress: {
            ...status.progress,
            indexedSessions: status.progress.indexedSessions + 1,
          },
        };
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    status = {
      ...status,
      progress: {
        ...status.progress,
        completedProviders: status.progress.completedProviders + 1,
      },
    };
  }

  documents.clear();
  for (const [sessionId, document] of nextDocuments.entries()) {
    documents.set(sessionId, document);
  }

  status = {
    ...status,
    state: "ready",
    progress: {
      ...status.progress,
      currentProvider: undefined,
    },
    counts: toProviderCounts(),
    completedAt: Date.now(),
    lastRefreshAt: Date.now(),
  };
}

export function getIndexStatus(): IndexStatus {
  return {
    ...status,
    progress: { ...status.progress },
    counts: { ...status.counts },
  };
}

export function searchIndex(
  query: string,
  provider: SessionProvider | "all" = "all",
): SearchMatch[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery || status.state !== "ready") {
    return [];
  }

  const matches: SearchMatch[] = [];

  const countOccurrences = (text: string, needle: string): number => {
    if (!needle) {
      return 0;
    }

    let count = 0;
    let fromIndex = 0;
    while (fromIndex <= text.length - needle.length) {
      const index = text.indexOf(needle, fromIndex);
      if (index === -1) {
        break;
      }
      count += 1;
      fromIndex = index + needle.length;
    }

    return count;
  };

  for (const document of documents.values()) {
    if (provider !== "all" && document.provider !== provider) {
      continue;
    }

    const hitCount = countOccurrences(document.text, normalizedQuery);
    if (hitCount > 0) {
      matches.push({ sessionId: document.sessionId, hitCount });
    }
  }

  return matches;
}

export function startIndexRefresh(): IndexStatus {
  if (refreshPromise) {
    return getIndexStatus();
  }

  const generation = status.generation + 1;
  status = {
    ...status,
    state: "indexing",
    progress: {
      totalSessions: 0,
      indexedSessions: 0,
      totalProviders: SESSION_PROVIDERS.length,
      completedProviders: 0,
      currentProvider: undefined,
    },
    generation,
    startedAt: Date.now(),
    completedAt: undefined,
    lastError: undefined,
  };

  refreshPromise = buildIndex(generation)
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Unknown indexing error";
      status = {
        ...status,
        state: "error",
        completedAt: Date.now(),
        lastError: message,
      };
    })
    .finally(() => {
      refreshPromise = null;
    });

  return getIndexStatus();
}
