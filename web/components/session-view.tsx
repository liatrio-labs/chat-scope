import { useEffect, useState, useRef, useCallback } from "react";
import type { ConversationMessage, SessionProvider } from "@claude-run/api";
import MessageBlock from "./message-block";
import ScrollToBottomButton from "./scroll-to-bottom-button";

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
  const containerRef = useRef<HTMLDivElement>(null);
  const lastMessageRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const isScrollingProgrammaticallyRef = useRef(false);
  const retryCountRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

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
      `/api/conversation/${sessionId}/stream?offset=${offsetRef.current}`
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
        const delay = Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, retryCountRef.current), MAX_RETRY_DELAY_MS);
        retryCountRef.current++;
        retryTimeoutRef.current = setTimeout(() => connect(), delay);
      }
    };
  }, [provider, sessionId]);

  const loadStaticConversation = useCallback(async () => {
    try {
      const response = await fetch(`/api/conversation/${encodeURIComponent(sessionId)}`);
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
    lastMessageRef.current.scrollIntoView({ behavior: "instant", block: "end" });
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
    const isAtBottom = scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD_PX;
    setAutoScroll(isAtBottom);
  };

  const summary = messages.find((m) => m.type === "summary");
  const conversationMessages = messages.filter(
    (m) => m.type === "user" || m.type === "assistant"
  );

  useEffect(() => {
    const root = containerRef.current;
    const query = searchQuery?.trim();
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
          fragment.appendChild(document.createTextNode(original.slice(cursor, index)));
        }

        const mark = document.createElement("mark");
        mark.setAttribute("data-search-highlight", "1");
        mark.className = "bg-amber-300/80 text-zinc-950 px-0.5 rounded-sm";
        mark.textContent = original.slice(index, index + match[0].length);
        fragment.appendChild(mark);
        cursor = index + match[0].length;
      }

      if (cursor < original.length) {
        fragment.appendChild(document.createTextNode(original.slice(cursor)));
      }

      node.parentNode?.replaceChild(fragment, node);
    }

    return () => {
      unwrapMarks();
    };
  }, [conversationMessages, searchQuery, summary]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        Loading...
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto bg-zinc-950"
      >
        <div className="mx-auto max-w-3xl px-4 py-4">
          {summary && (
            <div className="mb-6 rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
              <h2 className="text-sm font-medium text-zinc-200 leading-relaxed">
                {summary.summary}
              </h2>
              <p className="mt-2 text-[11px] text-zinc-500">
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
