import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import type { ConversationMessage, SessionProvider } from "@chat-scope/api";
import MessageBlock from "./message-block";
import ScrollToBottomButton from "./scroll-to-bottom-button";
import ScrollToTopButton from "./scroll-to-top-button";

const MAX_RETRIES = 10;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;
const SCROLL_THRESHOLD_PX = 100;

interface SessionViewProps {
  sessionId: string;
  provider: SessionProvider;
  searchQuery?: string;
}

function SessionView(props: SessionViewProps) {
  const { sessionId, provider, searchQuery } = props;

  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isAtTop, setIsAtTop] = useState(true);
  const [transcriptSearchQuery, setTranscriptSearchQuery] = useState(
    searchQuery?.trim() ?? "",
  );
  const [matchCount, setMatchCount] = useState(0);
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastMessageRef = useRef<HTMLDivElement>(null);
  const matchElementsRef = useRef<HTMLElement[]>([]);
  const offsetRef = useRef(0);
  const isScrollingProgrammaticallyRef = useRef(false);
  const retryCountRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const shouldScrollToFirstMatchRef = useRef(false);

  const connect = useCallback(() => {
    if (provider !== "claude") {
      return;
    }

    if (!mountedRef.current) {
      return;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(
      `/api/conversation/${encodeURIComponent(sessionId)}/stream?offset=${offsetRef.current}`,
    );
    eventSourceRef.current = eventSource;

    eventSource.addEventListener("messages", (event) => {
      retryCountRef.current = 0;
      const newMessages: ConversationMessage[] = JSON.parse(event.data);
      setLoading(false);
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.uuid).filter(Boolean));
        const unique = newMessages.filter((m) => !existingIds.has(m.uuid));
        if (unique.length === 0) {
          return prev;
        }
        offsetRef.current += unique.length;
        return [...prev, ...unique];
      });
    });

    eventSource.onerror = () => {
      eventSource.close();
      setLoading(false);

      if (!mountedRef.current) {
        return;
      }

      if (retryCountRef.current < MAX_RETRIES) {
        const delay = Math.min(
          BASE_RETRY_DELAY_MS * Math.pow(2, retryCountRef.current),
          MAX_RETRY_DELAY_MS,
        );
        retryCountRef.current++;
        retryTimeoutRef.current = setTimeout(() => connect(), delay);
      }
    };
  }, [provider, sessionId]);

  const loadStaticConversation = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/conversation/${encodeURIComponent(sessionId)}`,
      );
      if (!response.ok) {
        setMessages([]);
        setLoading(false);
        return;
      }

      const data: ConversationMessage[] = await response.json();
      setMessages(data);
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    setMessages([]);
    setIsAtTop(true);
    offsetRef.current = 0;
    retryCountRef.current = 0;

    if (provider === "claude") {
      connect();
    } else {
      loadStaticConversation();
    }

    return () => {
      mountedRef.current = false;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [connect, loadStaticConversation, provider]);

  const scrollToBottom = useCallback(() => {
    if (!lastMessageRef.current) {
      return;
    }
    isScrollingProgrammaticallyRef.current = true;
    lastMessageRef.current.scrollIntoView({
      behavior: "instant",
      block: "end",
    });
    requestAnimationFrame(() => {
      isScrollingProgrammaticallyRef.current = false;
      if (containerRef.current) {
        setIsAtTop(containerRef.current.scrollTop <= SCROLL_THRESHOLD_PX);
      }
    });
  }, []);

  const scrollToTop = useCallback(() => {
    if (!containerRef.current) {
      return;
    }

    isScrollingProgrammaticallyRef.current = true;
    containerRef.current.scrollTo({ top: 0, behavior: "auto" });
    setIsAtTop(true);
    setAutoScroll(false);

    requestAnimationFrame(() => {
      isScrollingProgrammaticallyRef.current = false;
    });
  }, []);

  useEffect(() => {
    if (autoScroll) {
      scrollToBottom();
    }
  }, [messages, autoScroll, scrollToBottom]);

  const handleScroll = () => {
    if (!containerRef.current || isScrollingProgrammaticallyRef.current) {
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom =
      scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD_PX;
    setAutoScroll(isAtBottom);
    setIsAtTop(scrollTop <= SCROLL_THRESHOLD_PX);
  };

  const summary = useMemo(
    () => messages.find((m) => m.type === "summary"),
    [messages],
  );
  const conversationMessages = useMemo(
    () => messages.filter((m) => m.type === "user" || m.type === "assistant"),
    [messages],
  );
  const normalizedTranscriptQuery = useMemo(
    () => transcriptSearchQuery.trim(),
    [transcriptSearchQuery],
  );

  useEffect(() => {
    const nextQuery = searchQuery?.trim() ?? "";
    setTranscriptSearchQuery(nextQuery);
    shouldScrollToFirstMatchRef.current = nextQuery.length > 0;
  }, [searchQuery, sessionId]);

  const activateMatch = useCallback((index: number, shouldScroll: boolean) => {
    const marks = matchElementsRef.current;
    if (marks.length === 0) {
      setActiveMatchIndex(-1);
      return;
    }

    const normalizedIndex =
      ((index % marks.length) + marks.length) % marks.length;

    for (const mark of marks) {
      mark.dataset.searchActive = "0";
      mark.style.backgroundColor = "rgba(137, 223, 0, 0.45)";
      mark.style.boxShadow = "none";
    }

    const activeMark = marks[normalizedIndex];
    activeMark.dataset.searchActive = "1";
    activeMark.style.backgroundColor = "rgba(36, 174, 29, 0.45)";
    activeMark.style.boxShadow = "0 0 0 1px rgba(137, 223, 0, 0.9)";

    if (shouldScroll) {
      activeMark.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    setActiveMatchIndex(normalizedIndex);
  }, []);

  const goToPreviousMatch = useCallback(() => {
    activateMatch(activeMatchIndex - 1, true);
  }, [activateMatch, activeMatchIndex]);

  const goToNextMatch = useCallback(() => {
    activateMatch(activeMatchIndex + 1, true);
  }, [activateMatch, activeMatchIndex]);

  useEffect(() => {
    const root = containerRef.current;
    const query = normalizedTranscriptQuery;
    if (!root) {
      return;
    }

    const unwrapMarks = () => {
      const marks = root.querySelectorAll("mark[data-search-highlight='1']");
      for (const mark of marks) {
        const parent = mark.parentNode;
        if (!parent) {
          continue;
        }
        const text = document.createTextNode(mark.textContent ?? "");
        parent.replaceChild(text, mark);
        parent.normalize();
      }

      matchElementsRef.current = [];
      setMatchCount(0);
      setActiveMatchIndex(-1);
    };

    unwrapMarks();

    if (!query) {
      return;
    }

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matcher = new RegExp(escaped, "gi");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];

    while (walker.nextNode()) {
      const current = walker.currentNode as Text;
      const value = current.nodeValue ?? "";
      if (!value.trim()) {
        continue;
      }
      if (current.parentElement?.closest("mark[data-search-highlight='1']")) {
        continue;
      }
      textNodes.push(current);
    }

    for (const node of textNodes) {
      const original = node.nodeValue ?? "";
      matcher.lastIndex = 0;
      const matches = [...original.matchAll(matcher)];
      if (matches.length === 0) {
        continue;
      }

      const fragment = document.createDocumentFragment();
      let cursor = 0;

      for (const match of matches) {
        const index = match.index ?? -1;
        if (index < 0) {
          continue;
        }

        if (index > cursor) {
          fragment.appendChild(
            document.createTextNode(original.slice(cursor, index)),
          );
        }

        const mark = document.createElement("mark");
        mark.setAttribute("data-search-highlight", "1");
        mark.className = "text-[var(--brand-text-primary)] px-0.5 rounded-sm";
        mark.style.backgroundColor = "rgba(137, 223, 0, 0.45)";
        mark.textContent = original.slice(index, index + match[0].length);
        fragment.appendChild(mark);
        cursor = index + match[0].length;
      }

      if (cursor < original.length) {
        fragment.appendChild(document.createTextNode(original.slice(cursor)));
      }

      node.parentNode?.replaceChild(fragment, node);
    }

    const marks = Array.from(
      root.querySelectorAll("mark[data-search-highlight='1']"),
    ) as HTMLElement[];

    matchElementsRef.current = marks;
    setMatchCount(marks.length);

    if (marks.length > 0) {
      const shouldScrollToFirstMatch = shouldScrollToFirstMatchRef.current;
      activateMatch(0, shouldScrollToFirstMatch);
      if (shouldScrollToFirstMatch) {
        setAutoScroll(false);
        shouldScrollToFirstMatchRef.current = false;
      }
    }

    return () => {
      unwrapMarks();
    };
  }, [activateMatch, conversationMessages, normalizedTranscriptQuery, summary]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--brand-text-muted)]">
        Loading...
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto bg-[var(--brand-bg-primary)]"
      >
        <div className="sticky top-0 z-20 border-b border-[var(--brand-border)]/75 bg-[var(--brand-bg-secondary)]/95 backdrop-blur px-4 py-3">
          <div className="mx-auto max-w-3xl flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <input
                type="text"
                value={transcriptSearchQuery}
                onChange={(e) => setTranscriptSearchQuery(e.target.value)}
                placeholder="Search in transcript..."
                className="w-full max-w-sm rounded-[10px] border border-[var(--brand-border-soft)] bg-[var(--brand-bg-tertiary)]/85 px-2.5 py-2 text-xs text-[var(--brand-text-primary)] placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:border-[var(--brand-primary)]"
              />
              {normalizedTranscriptQuery && (
                <button
                  onClick={() => setTranscriptSearchQuery("")}
                  className="rounded-[10px] border border-[var(--brand-border-soft)] px-2 py-1 text-[11px] text-[var(--brand-text-secondary)] hover:bg-[var(--brand-bg-tertiary)]/85"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="text-xs text-[var(--brand-text-secondary)] min-w-[160px] text-right">
                {normalizedTranscriptQuery
                  ? matchCount > 0
                    ? `Matches ${activeMatchIndex + 1}/${matchCount}`
                    : "No matches"
                  : "Type to search"}
              </div>
              <button
                onClick={goToPreviousMatch}
                disabled={matchCount === 0}
                className="rounded-[10px] border border-[var(--brand-border-soft)] px-2 py-1 text-[11px] text-[var(--brand-text-secondary)] hover:bg-[var(--brand-bg-tertiary)]/85 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Prev
              </button>
              <button
                onClick={goToNextMatch}
                disabled={matchCount === 0}
                className="rounded-[10px] border border-[var(--brand-border-soft)] px-2 py-1 text-[11px] text-[var(--brand-text-secondary)] hover:bg-[var(--brand-bg-tertiary)]/85 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-3xl px-4 py-4">
          {summary && (
            <div className="mb-6 rounded-[14px] border border-[var(--brand-border-soft)] bg-[var(--brand-bg-secondary)]/75 p-4 shadow-[var(--brand-shadow)]">
              <h2 className="text-sm font-semibold text-[var(--brand-text-primary)] leading-relaxed">
                {summary.summary}
              </h2>
              <p className="mt-2 text-[11px] text-[var(--brand-text-muted)]">
                {conversationMessages.length} messages
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {conversationMessages.map((message, index) => (
              <div
                key={message.uuid || index}
                ref={
                  index === conversationMessages.length - 1
                    ? lastMessageRef
                    : undefined
                }
              >
                <MessageBlock message={message} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {!isAtTop && <ScrollToTopButton onClick={scrollToTop} />}

      {!autoScroll && (
        <ScrollToBottomButton
          onClick={() => {
            setAutoScroll(true);
            scrollToBottom();
          }}
        />
      )}
    </div>
  );
}

export default SessionView;
