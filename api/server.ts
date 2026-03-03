import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import {
  initStorage,
  loadStorage,
  getClaudeDir,
  getSessions,
  getProjects,
  getConversation,
  getConversationStream,
  isClaudeSessionId,
  normalizeProvider,
  invalidateHistoryCache,
  addToFileIndex,
} from "./storage";
import {
  getIndexStatus,
  searchIndex,
  startIndexRefresh,
  type IndexStatus,
} from "./indexer";
import {
  initWatcher,
  startWatcher,
  stopWatcher,
  onHistoryChange,
  offHistoryChange,
  onSessionChange,
  offSessionChange,
} from "./watcher";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import open from "open";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getWebDistPath(): string {
  const prodPath = join(__dirname, "web");
  if (existsSync(prodPath)) {
    return prodPath;
  }
  return join(__dirname, "..", "dist", "web");
}

export interface ServerOptions {
  port: number;
  claudeDir?: string;
  dev?: boolean;
  open?: boolean;
}

interface SessionSearchResponse {
  sessions: Awaited<ReturnType<typeof getSessions>>;
  hitsBySessionId: Record<string, number>;
  status: IndexStatus;
  query: string;
}

export function createServer(options: ServerOptions) {
  const { port, claudeDir, dev = false, open: shouldOpen = true } = options;

  initStorage(claudeDir);
  initWatcher(getClaudeDir());

  const app = new Hono();

  if (dev) {
    app.use(
      "*",
      cors({
        origin: ["http://localhost:12000"],
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["Content-Type"],
      }),
    );
  }

  app.get("/api/sessions", async (c) => {
    const provider = normalizeProvider(c.req.query("provider"));
    const sessions = await getSessions(provider);
    return c.json(sessions);
  });

  app.get("/api/projects", async (c) => {
    const provider = normalizeProvider(c.req.query("provider"));
    const projects = await getProjects(provider);
    return c.json(projects);
  });

  app.get("/api/sessions/search", async (c) => {
    const provider = normalizeProvider(c.req.query("provider"));
    const query = c.req.query("query") ?? "";

    let sessions = await getSessions(provider);
    const hitsBySessionId: Record<string, number> = {};
    const normalizedQuery = query.trim();
    const status = getIndexStatus();

    if (normalizedQuery) {
      const matches = searchIndex(normalizedQuery, provider);
      if (status.state === "ready") {
        const matchIdSet = new Set(matches.map((match) => match.sessionId));
        for (const match of matches) {
          hitsBySessionId[match.sessionId] = match.hitCount;
        }
        sessions = sessions.filter((session) => matchIdSet.has(session.id));
      } else {
        sessions = [];
      }
    }

    const response: SessionSearchResponse = {
      sessions,
      hitsBySessionId,
      status,
      query: normalizedQuery,
    };

    return c.json(response);
  });

  app.get("/api/index/status", (c) => {
    return c.json(getIndexStatus());
  });

  app.post("/api/index/refresh", (c) => {
    const alreadyIndexing = getIndexStatus().state === "indexing";
    const status = startIndexRefresh();
    return c.json({
      accepted: !alreadyIndexing,
      generation: status.generation,
      status,
    });
  });

  app.get("/api/sessions/stream", async (c) => {
    const requestedProvider = normalizeProvider(c.req.query("provider"));
    const streamProvider =
      requestedProvider === "all" || requestedProvider === "claude"
        ? requestedProvider
        : "claude";

    return streamSSE(c, async (stream) => {
      let isConnected = true;
      const knownSessions = new Map<string, number>();

      const cleanup = () => {
        isConnected = false;
        offHistoryChange(handleHistoryChange);
      };

      const handleHistoryChange = async () => {
        if (!isConnected) {
          return;
        }
        try {
          const sessions = await getSessions(streamProvider);
          const newOrUpdated = sessions.filter((s) => {
            const known = knownSessions.get(s.id);
            return known === undefined || known !== s.timestamp;
          });

          for (const s of sessions) {
            knownSessions.set(s.id, s.timestamp);
          }

          if (newOrUpdated.length > 0) {
            await stream.writeSSE({
              event: "sessionsUpdate",
              data: JSON.stringify(newOrUpdated),
            });
          }
        } catch {
          cleanup();
        }
      };

      onHistoryChange(handleHistoryChange);
      c.req.raw.signal.addEventListener("abort", cleanup);

      try {
        const sessions = await getSessions(streamProvider);
        for (const s of sessions) {
          knownSessions.set(s.id, s.timestamp);
        }

        await stream.writeSSE({
          event: "sessions",
          data: JSON.stringify(sessions),
        });

        while (isConnected) {
          await stream.writeSSE({
            event: "heartbeat",
            data: JSON.stringify({ timestamp: Date.now() }),
          });
          await stream.sleep(30000);
        }
      } catch {
        // Connection closed
      } finally {
        cleanup();
      }
    });
  });

  app.get("/api/conversation/:id", async (c) => {
    const sessionId = c.req.param("id");
    const messages = await getConversation(sessionId);
    return c.json(messages);
  });

  app.get("/api/conversation/:id/stream", async (c) => {
    const sessionId = c.req.param("id");

    if (!isClaudeSessionId(sessionId)) {
      return c.json(
        { error: "Streaming is only supported for Claude sessions" },
        400,
      );
    }

    const offsetParam = c.req.query("offset");
    let offset = offsetParam ? parseInt(offsetParam, 10) : 0;

    return streamSSE(c, async (stream) => {
      let isConnected = true;

      const cleanup = () => {
        isConnected = false;
        offSessionChange(handleSessionChange);
      };

      const handleSessionChange = async (changedSessionId: string) => {
        if (changedSessionId !== sessionId || !isConnected) {
          return;
        }

        const { messages: newMessages, nextOffset: newOffset } =
          await getConversationStream(sessionId, offset);
        offset = newOffset;

        if (newMessages.length > 0) {
          try {
            await stream.writeSSE({
              event: "messages",
              data: JSON.stringify(newMessages),
            });
          } catch {
            cleanup();
          }
        }
      };

      onSessionChange(handleSessionChange);
      c.req.raw.signal.addEventListener("abort", cleanup);

      try {
        const { messages, nextOffset } = await getConversationStream(
          sessionId,
          offset,
        );
        offset = nextOffset;

        await stream.writeSSE({
          event: "messages",
          data: JSON.stringify(messages),
        });

        while (isConnected) {
          await stream.writeSSE({
            event: "heartbeat",
            data: JSON.stringify({ timestamp: Date.now() }),
          });
          await stream.sleep(30000);
        }
      } catch {
        // Connection closed
      } finally {
        cleanup();
      }
    });
  });

  const webDistPath = getWebDistPath();

  app.use("/*", serveStatic({ root: webDistPath }));

  app.get("/*", async (c) => {
    const indexPath = join(webDistPath, "index.html");
    try {
      const html = readFileSync(indexPath, "utf-8");
      return c.html(html);
    } catch {
      return c.text("UI not found. Run 'pnpm build' first.", 404);
    }
  });

  onHistoryChange(() => {
    invalidateHistoryCache();
  });

  onSessionChange((sessionId: string, filePath: string) => {
    addToFileIndex(sessionId, filePath);
  });

  startWatcher();

  let httpServer: ServerType | null = null;

  return {
    app,
    port,
    start: async () => {
      await loadStorage();
      startIndexRefresh();
      const openUrl = `http://localhost:${dev ? 12000 : port}/`;

      console.log(`\n  chat-scope is running at ${openUrl}\n`);
      if (!dev && shouldOpen) {
        open(openUrl).catch(console.error);
      }

      httpServer = serve({
        fetch: app.fetch,
        port,
      });

      return httpServer;
    },
    stop: () => {
      stopWatcher();
      if (httpServer) {
        httpServer.close();
      }
    },
  };
}
