import { readdir, readFile, stat, open } from "fs/promises";
import { join, basename, dirname, resolve } from "path";
import { homedir } from "os";
import { createInterface } from "readline";
import { execFile } from "child_process";
import { promisify } from "util";

export type SessionProvider = "claude" | "codex" | "opencode" | "cursor";
export const SESSION_PROVIDERS: SessionProvider[] = [
  "claude",
  "codex",
  "opencode",
  "cursor",
];

export interface HistoryEntry {
  display: string;
  timestamp: number;
  project: string;
  sessionId?: string;
}

export interface Session {
  id: string;
  sourceId: string;
  provider: SessionProvider;
  display: string;
  timestamp: number;
  project: string;
  projectName: string;
  transcriptPath?: string;
  canResume: boolean;
}

export interface ConversationMessage {
  type: "user" | "assistant" | "summary" | "file-history-snapshot";
  uuid?: string;
  parentUuid?: string;
  timestamp?: string;
  sessionId?: string;
  message?: {
    role: string;
    content: string | ContentBlock[];
    model?: string;
    usage?: TokenUsage;
  };
  summary?: string;
}

export interface ContentBlock {
  type: "text" | "thinking" | "tool_use" | "tool_result";
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface StreamResult {
  messages: ConversationMessage[];
  nextOffset: number;
}

function extractTextFromContentBlock(block: ContentBlock): string {
  if (block.type === "text") {
    return block.text ?? "";
  }

  if (block.type === "thinking") {
    return block.thinking ?? "";
  }

  if (block.type === "tool_result") {
    if (typeof block.content === "string") {
      return block.content;
    }

    if (Array.isArray(block.content)) {
      return block.content
        .map((inner) => extractTextFromContentBlock(inner))
        .join("\n");
    }
  }

  if (block.type === "tool_use") {
    return [block.name, block.input ? JSON.stringify(block.input) : ""]
      .filter(Boolean)
      .join(" ");
  }

  return "";
}

function messageToSearchText(message: ConversationMessage): string {
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

  return content.map((block) => extractTextFromContentBlock(block)).join("\n");
}

const CLAUDE_PROVIDER: SessionProvider = "claude";
const SESSION_ID_SEPARATOR = ":";

let claudeDir = join(homedir(), ".claude");
let projectsDir = join(claudeDir, "projects");
let codexSessionsDir = join(homedir(), ".codex", "sessions");
let openCodeStorageDir = join(
  homedir(),
  ".local",
  "share",
  "opencode",
  "storage",
);
let openCodeDbPath = join(
  homedir(),
  ".local",
  "share",
  "opencode",
  "opencode.db",
);
let cursorProjectsDir = join(homedir(), ".cursor", "projects");

const openCodeSessionDir = () => join(openCodeStorageDir, "session");
const openCodeMessageDir = () => join(openCodeStorageDir, "message");
const openCodePartDir = () => join(openCodeStorageDir, "part");

const claudeFileIndex = new Map<string, string>();
const codexFileIndex = new Map<string, string>();
const cursorFileIndex = new Map<string, string>();
const cursorProjectPathCache = new Map<string, string>();
let openCodeConversationCache: Map<string, ConversationMessage[]> | null = null;
let openCodeConversationCacheMtime = 0;
let openCodeSearchTextCache: Map<string, string> | null = null;
let openCodeSearchTextCacheMtime = 0;
let openCodeSearchTextCachePromise: Promise<void> | null = null;
let historyCache: HistoryEntry[] | null = null;
const pendingRequests = new Map<string, Promise<unknown>>();
const execFileAsync = promisify(execFile);
const SQLITE_QUERY_TIMEOUT_MS = 30000;
const TRANSCRIPT_SEARCH_CHUNK_SIZE = 16;

function isProcessTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    code?: string;
    signal?: string;
    message?: string;
    killed?: boolean;
  };

  if (candidate.code === "ETIMEDOUT" || candidate.signal === "SIGTERM") {
    return true;
  }

  if (typeof candidate.message === "string") {
    return candidate.message.toLowerCase().includes("timed out");
  }

  return Boolean(candidate.killed);
}

export function initStorage(dir?: string): void {
  claudeDir = dir ?? join(homedir(), ".claude");
  projectsDir = join(claudeDir, "projects");
  codexSessionsDir = join(homedir(), ".codex", "sessions");
  openCodeStorageDir = join(
    homedir(),
    ".local",
    "share",
    "opencode",
    "storage",
  );
  openCodeDbPath = join(
    homedir(),
    ".local",
    "share",
    "opencode",
    "opencode.db",
  );
  cursorProjectsDir = join(homedir(), ".cursor", "projects");
  cursorFileIndex.clear();
  cursorProjectPathCache.clear();
  openCodeConversationCache = null;
  openCodeConversationCacheMtime = 0;
  openCodeSearchTextCache = null;
  openCodeSearchTextCacheMtime = 0;
  openCodeSearchTextCachePromise = null;
}

export function getClaudeDir(): string {
  return claudeDir;
}

export function invalidateHistoryCache(): void {
  historyCache = null;
}

export function addToFileIndex(sessionId: string, filePath: string): void {
  claudeFileIndex.set(sessionId, filePath);
}

export function createSessionId(
  provider: SessionProvider,
  sourceId: string,
): string {
  return `${provider}${SESSION_ID_SEPARATOR}${sourceId}`;
}

function parseSessionId(sessionId: string): {
  provider: SessionProvider;
  sourceId: string;
} {
  const separatorIndex = sessionId.indexOf(SESSION_ID_SEPARATOR);
  if (separatorIndex > 0) {
    const providerCandidate = sessionId.slice(0, separatorIndex);
    if (SESSION_PROVIDERS.includes(providerCandidate as SessionProvider)) {
      return {
        provider: providerCandidate as SessionProvider,
        sourceId: sessionId.slice(separatorIndex + 1),
      };
    }
  }

  // Backward compatibility with old IDs that were just Claude session IDs.
  return { provider: CLAUDE_PROVIDER, sourceId: sessionId };
}

export function isClaudeSessionId(sessionId: string): boolean {
  const parsed = parseSessionId(sessionId);
  return parsed.provider === CLAUDE_PROVIDER;
}

function encodeProjectPath(path: string): string {
  return path.replace(/[/.]/g, "-");
}

function getProjectName(projectPath: string): string {
  const parts = projectPath.split("/").filter(Boolean);
  return parts[parts.length - 1] || projectPath;
}

function getProviderFromQuery(
  provider?: string | null,
): SessionProvider | "all" {
  if (!provider || provider === "all") {
    return "all";
  }

  if (SESSION_PROVIDERS.includes(provider as SessionProvider)) {
    return provider as SessionProvider;
  }

  return "all";
}

export function normalizeProvider(
  provider?: string | null,
): SessionProvider | "all" {
  return getProviderFromQuery(provider);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function runSqliteJsonQuery<T>(query: string): Promise<T[]> {
  let stdout: string;
  try {
    const result = await execFileAsync(
      "sqlite3",
      ["-json", openCodeDbPath, query],
      {
        maxBuffer: 1024 * 1024 * 512,
        timeout: SQLITE_QUERY_TIMEOUT_MS,
      },
    );
    stdout = result.stdout;
  } catch (error) {
    if (isProcessTimeoutError(error)) {
      throw new Error(
        `sqlite3 query timed out after ${SQLITE_QUERY_TIMEOUT_MS}ms`,
      );
    }
    throw error;
  }

  const output = stdout.trim();
  if (!output) {
    return [];
  }

  return JSON.parse(output) as T[];
}

async function getFilesRecursively(
  rootDir: string,
  filter: (filePath: string) => boolean,
): Promise<string[]> {
  const files: string[] = [];

  async function walk(dirPath: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          await walk(entryPath);
          return;
        }

        if (entry.isFile() && filter(entryPath)) {
          files.push(entryPath);
        }
      }),
    );
  }

  await walk(rootDir);
  return files;
}

async function buildClaudeFileIndex(): Promise<void> {
  try {
    const projectDirs = await readdir(projectsDir, { withFileTypes: true });
    const directories = projectDirs.filter((d) => d.isDirectory());

    await Promise.all(
      directories.map(async (dir) => {
        try {
          const projectPath = join(projectsDir, dir.name);
          const files = await readdir(projectPath);
          for (const file of files) {
            if (file.endsWith(".jsonl")) {
              const sessionId = basename(file, ".jsonl");
              claudeFileIndex.set(sessionId, join(projectPath, file));
            }
          }
        } catch {
          // Ignore errors for individual directories.
        }
      }),
    );
  } catch {
    // Projects directory may not exist yet.
  }
}

async function loadHistoryCache(): Promise<HistoryEntry[]> {
  try {
    const historyPath = join(claudeDir, "history.jsonl");
    const content = await readFile(historyPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const entries: HistoryEntry[] = [];

    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip malformed lines.
      }
    }

    historyCache = entries;
    return entries;
  } catch {
    historyCache = [];
    return [];
  }
}

async function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = pendingRequests.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = fn().finally(() => {
    pendingRequests.delete(key);
  });

  pendingRequests.set(key, promise);
  return promise;
}

async function findClaudeSessionByTimestamp(
  encodedProject: string,
  timestamp: number,
): Promise<string | undefined> {
  try {
    const projectPath = join(projectsDir, encodedProject);
    const files = await readdir(projectPath);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

    const fileStats = await Promise.all(
      jsonlFiles.map(async (file) => {
        const filePath = join(projectPath, file);
        const fileStat = await stat(filePath);
        return { file, mtime: fileStat.mtimeMs };
      }),
    );

    let closestFile: string | null = null;
    let closestTimeDiff = Infinity;

    for (const { file, mtime } of fileStats) {
      const timeDiff = Math.abs(mtime - timestamp);
      if (timeDiff < closestTimeDiff) {
        closestTimeDiff = timeDiff;
        closestFile = file;
      }
    }

    if (closestFile) {
      return basename(closestFile, ".jsonl");
    }
  } catch {
    // Project directory doesn't exist.
  }

  return undefined;
}

async function findClaudeSessionFile(sourceId: string): Promise<string | null> {
  if (claudeFileIndex.has(sourceId)) {
    return claudeFileIndex.get(sourceId)!;
  }

  const targetFile = `${sourceId}.jsonl`;

  try {
    const projectDirs = await readdir(projectsDir, { withFileTypes: true });
    const directories = projectDirs.filter((d) => d.isDirectory());

    const results = await Promise.all(
      directories.map(async (dir) => {
        try {
          const projectPath = join(projectsDir, dir.name);
          const files = await readdir(projectPath);
          if (files.includes(targetFile)) {
            return join(projectPath, targetFile);
          }
        } catch {
          // Ignore errors for individual directories.
        }
        return null;
      }),
    );

    const filePath = results.find((r) => r !== null);
    if (filePath) {
      claudeFileIndex.set(sourceId, filePath);
      return filePath;
    }
  } catch (err) {
    console.error("Error finding Claude session file:", err);
  }

  return null;
}

interface CodexSessionMetaPayload {
  id?: string;
  timestamp?: string;
  cwd?: string;
}

interface CodexRecord {
  timestamp?: string;
  type?: string;
  payload?: {
    id?: string;
    type?: string;
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
    timestamp?: string;
    cwd?: string;
  } & CodexSessionMetaPayload;
}

async function getCodexSessionFiles(): Promise<string[]> {
  return getFilesRecursively(codexSessionsDir, (filePath) =>
    filePath.endsWith(".jsonl"),
  );
}

interface CursorTranscriptRecord {
  role?: string;
  timestamp?: string;
  message?: {
    content?:
      | string
      | Array<{
          type?: string;
          text?: string;
        }>;
  };
}

function getCursorProjectKeyFromPath(filePath: string): string {
  const normalizedRoot = cursorProjectsDir.endsWith("/")
    ? cursorProjectsDir
    : `${cursorProjectsDir}/`;
  if (!filePath.startsWith(normalizedRoot)) {
    return "";
  }

  const relative = filePath.slice(normalizedRoot.length);
  return relative.split("/")[0] ?? "";
}

function createCursorSourceId(
  projectKey: string,
  transcriptId: string,
): string {
  if (!projectKey) {
    return transcriptId;
  }

  return `${projectKey}:${transcriptId}`;
}

function decodeCursorProjectKey(projectKey: string): string {
  let decoded = `/${projectKey.replace(/-/g, "/")}`;
  decoded = decoded.replace(/\/workspace\/json$/, "/workspace.json");
  decoded = decoded.replace(
    /\/config\/Cursor\/Workspaces\//,
    "/.config/Cursor/Workspaces/",
  );
  return decoded;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function reconstructCursorProjectPath(
  projectKey: string,
): Promise<string | null> {
  const tokens = projectKey.split("-").filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }

  let currentPath = "/";
  let index = 0;

  while (index < tokens.length) {
    let matchedPath: string | null = null;
    let consumed = 0;

    const maxJoin = Math.min(tokens.length - index, 6);
    for (let size = maxJoin; size >= 1; size -= 1) {
      const slice = tokens.slice(index, index + size);
      const dashed = slice.join("-");
      const dotted =
        size >= 2
          ? `${slice.slice(0, -1).join("-")}.${slice[slice.length - 1]}`
          : null;
      const candidates = [dashed, dotted].filter((value): value is string =>
        Boolean(value),
      );

      if (dashed === "config") {
        candidates.push(".config");
      }

      for (const candidate of candidates) {
        const candidatePath = join(currentPath, candidate);
        if (await pathExists(candidatePath)) {
          matchedPath = candidatePath;
          consumed = size;
          break;
        }
      }

      if (matchedPath) {
        break;
      }
    }

    if (!matchedPath || consumed <= 0) {
      return null;
    }

    currentPath = matchedPath;
    index += consumed;
  }

  return currentPath;
}

async function resolveCursorProjectPath(projectKey: string): Promise<string> {
  if (!projectKey) {
    return projectKey;
  }

  const cached = cursorProjectPathCache.get(projectKey);
  if (cached) {
    return cached;
  }

  let resolvedPath = decodeCursorProjectKey(projectKey);
  const reconstructedPath = await reconstructCursorProjectPath(projectKey);
  if (reconstructedPath) {
    resolvedPath = reconstructedPath;
  }

  if (resolvedPath.endsWith("/workspace.json")) {
    try {
      const workspaceRaw = await readFile(resolvedPath, "utf-8");
      const workspace = JSON.parse(workspaceRaw) as {
        folders?: Array<{ path?: string }>;
      };
      const folderPath = workspace.folders?.[0]?.path;
      if (folderPath) {
        resolvedPath = folderPath.startsWith("/")
          ? folderPath
          : resolve(dirname(resolvedPath), folderPath);
      }
    } catch {
      // Fall back to decoded workspace.json path.
    }
  }

  cursorProjectPathCache.set(projectKey, resolvedPath);
  return resolvedPath;
}

function parseCursorSourceId(sourceId: string): {
  projectKey: string;
  transcriptId: string;
} {
  const separatorIndex = sourceId.indexOf(":");
  if (separatorIndex <= 0) {
    return { projectKey: "", transcriptId: sourceId };
  }

  return {
    projectKey: sourceId.slice(0, separatorIndex),
    transcriptId: sourceId.slice(separatorIndex + 1),
  };
}

function getTextFromCursorContent(
  content:
    | string
    | Array<{
        type?: string;
        text?: string;
      }>
    | undefined,
): string {
  if (!content) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  return content
    .map((item) => item.text ?? "")
    .filter((text) => text.trim().length > 0)
    .join("\n");
}

async function getCursorTranscriptFiles(): Promise<string[]> {
  return getFilesRecursively(
    cursorProjectsDir,
    (filePath) =>
      filePath.endsWith(".jsonl") && filePath.includes("/agent-transcripts/"),
  );
}

async function getCursorSessions(): Promise<Session[]> {
  const files = await getCursorTranscriptFiles();
  const sessions: Session[] = [];

  await Promise.all(
    files.map(async (filePath) => {
      try {
        const transcriptId = basename(filePath, ".jsonl");
        const projectKey = getCursorProjectKeyFromPath(filePath);
        const projectPath = await resolveCursorProjectPath(projectKey);
        const sourceId = createCursorSourceId(projectKey, transcriptId);
        const content = await readFile(filePath, "utf-8");
        const lines = content.split("\n").filter(Boolean);

        let display = "";
        for (const line of lines) {
          let record: CursorTranscriptRecord;
          try {
            record = JSON.parse(line) as CursorTranscriptRecord;
          } catch {
            continue;
          }

          if (record.role !== "user") {
            continue;
          }

          display = getTextFromCursorContent(record.message?.content).trim();
          if (display) {
            break;
          }
        }

        const fileStat = await stat(filePath);

        cursorFileIndex.set(sourceId, filePath);

        sessions.push({
          id: createSessionId("cursor", sourceId),
          sourceId,
          provider: "cursor",
          display: display || `Session ${transcriptId.slice(0, 8)}`,
          timestamp: fileStat.mtimeMs,
          project: projectPath || projectKey,
          projectName:
            basename(projectPath || projectKey) || projectKey || "Unknown",
          transcriptPath: filePath,
          canResume: false,
        });
      } catch {
        // Ignore malformed Cursor transcript files.
      }
    }),
  );

  return sessions;
}

async function findCursorTranscriptFile(
  sourceId: string,
): Promise<string | null> {
  if (cursorFileIndex.has(sourceId)) {
    return cursorFileIndex.get(sourceId)!;
  }

  const { projectKey, transcriptId } = parseCursorSourceId(sourceId);

  const files = await getCursorTranscriptFiles();
  for (const filePath of files) {
    const fileTranscriptId = basename(filePath, ".jsonl");
    if (fileTranscriptId !== transcriptId) {
      continue;
    }

    const fileProjectKey = getCursorProjectKeyFromPath(filePath);
    if (projectKey && fileProjectKey !== projectKey) {
      continue;
    }

    if (!projectKey) {
      const canonicalSourceId = createCursorSourceId(
        fileProjectKey,
        fileTranscriptId,
      );
      cursorFileIndex.set(canonicalSourceId, filePath);
      cursorFileIndex.set(sourceId, filePath);
      return filePath;
    }

    if (fileProjectKey === projectKey) {
      cursorFileIndex.set(sourceId, filePath);
      return filePath;
    }
  }

  return null;
}

async function getCursorConversation(
  sourceId: string,
): Promise<ConversationMessage[]> {
  const filePath = await findCursorTranscriptFile(sourceId);
  if (!filePath) {
    return [];
  }

  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    const messages: ConversationMessage[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      let record: CursorTranscriptRecord;
      try {
        record = JSON.parse(lines[index]) as CursorTranscriptRecord;
      } catch {
        continue;
      }

      const role = record.role;
      if (role !== "user" && role !== "assistant") {
        continue;
      }

      const text = getTextFromCursorContent(record.message?.content).trim();
      if (!text) {
        continue;
      }

      messages.push(
        createSimpleMessage(
          role,
          text,
          `${sourceId}:${index}`,
          record.timestamp,
        ),
      );
    }

    return messages;
  } catch {
    return [];
  }
}

function parseCodexTimestamp(value?: string): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getTextFromCodexContent(
  content: Array<{ type?: string; text?: string }> | undefined,
): string {
  if (!content || content.length === 0) {
    return "";
  }

  return content
    .map((item) => item.text ?? "")
    .filter((text) => text.trim().length > 0)
    .join("\n");
}

async function getCodexSessions(): Promise<Session[]> {
  const files = await getCodexSessionFiles();
  const sessions: Session[] = [];

  await Promise.all(
    files.map(async (filePath) => {
      try {
        const content = await readFile(filePath, "utf-8");
        const lines = content.split("\n").filter(Boolean);

        let meta: CodexSessionMetaPayload | null = null;
        let display = "";

        for (const line of lines) {
          let record: CodexRecord;
          try {
            record = JSON.parse(line) as CodexRecord;
          } catch {
            continue;
          }

          if (!meta && record.type === "session_meta" && record.payload) {
            meta = record.payload;
          }

          if (
            !display &&
            record.type === "response_item" &&
            record.payload?.type === "message" &&
            record.payload.role === "user"
          ) {
            display = getTextFromCodexContent(record.payload.content)?.trim();
          }

          if (meta && display) {
            break;
          }
        }

        if (!meta?.id) {
          return;
        }

        codexFileIndex.set(meta.id, filePath);

        const projectPath = meta.cwd ?? "";
        const sessionId = createSessionId("codex", meta.id);
        const fallbackDisplay = display || `Session ${meta.id.slice(0, 8)}`;

        sessions.push({
          id: sessionId,
          sourceId: meta.id,
          provider: "codex",
          display: fallbackDisplay,
          timestamp: parseCodexTimestamp(meta.timestamp),
          project: projectPath,
          projectName: projectPath ? getProjectName(projectPath) : "Unknown",
          transcriptPath: filePath,
          canResume: false,
        });
      } catch {
        // Ignore malformed files.
      }
    }),
  );

  return sessions;
}

async function findCodexSessionFile(sourceId: string): Promise<string | null> {
  if (codexFileIndex.has(sourceId)) {
    return codexFileIndex.get(sourceId)!;
  }

  const files = await getCodexSessionFiles();

  for (const filePath of files) {
    try {
      const content = await readFile(filePath, "utf-8");
      const firstLine = content.split("\n").find(Boolean);
      if (!firstLine) {
        continue;
      }

      const record = JSON.parse(firstLine) as CodexRecord;
      if (record.type === "session_meta" && record.payload?.id === sourceId) {
        codexFileIndex.set(sourceId, filePath);
        return filePath;
      }
    } catch {
      // Ignore malformed files.
    }
  }

  return null;
}

function createSimpleMessage(
  role: "user" | "assistant",
  text: string,
  uuid?: string,
  timestamp?: string,
): ConversationMessage {
  return {
    type: role,
    uuid,
    timestamp,
    message: {
      role,
      content: text,
    },
  };
}

async function getCodexConversation(
  sourceId: string,
): Promise<ConversationMessage[]> {
  const filePath = await findCodexSessionFile(sourceId);
  if (!filePath) {
    return [];
  }

  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    const messages: ConversationMessage[] = [];

    for (const line of lines) {
      let record: CodexRecord;
      try {
        record = JSON.parse(line) as CodexRecord;
      } catch {
        continue;
      }

      if (record.type !== "response_item") {
        continue;
      }

      if (record.payload?.type !== "message") {
        continue;
      }

      const role = record.payload.role;
      if (role !== "user" && role !== "assistant") {
        continue;
      }

      const text = getTextFromCodexContent(record.payload.content).trim();
      if (!text) {
        continue;
      }

      messages.push(
        createSimpleMessage(role, text, record.payload.id, record.timestamp),
      );
    }

    return messages;
  } catch {
    return [];
  }
}

interface OpenCodeSessionFile {
  id: string;
  title?: string;
  directory?: string;
  time?: {
    created?: number;
    updated?: number;
  };
}

interface OpenCodeMessageFile {
  id: string;
  sessionID: string;
  role?: string;
  parentID?: string;
  time?: {
    created?: number;
    completed?: number;
  };
  modelID?: string;
}

interface OpenCodeToolState {
  status?: string;
  input?: Record<string, unknown>;
  output?: unknown;
}

interface OpenCodePartFile {
  id: string;
  messageID: string;
  sessionID: string;
  type: string;
  text?: string;
  tool?: string;
  callID?: string;
  state?: OpenCodeToolState;
}

interface OpenCodeDbSessionRow {
  id: string;
  title?: string;
  directory?: string;
  time_created?: number;
  time_updated?: number;
}

interface OpenCodeDbMessageRow {
  id: string;
  session_id: string;
  time_created?: number;
  time_updated?: number;
  data: string;
}

interface OpenCodeDbPartRow {
  id: string;
  message_id: string;
  session_id: string;
  time_created?: number;
  time_updated?: number;
  data: string;
}

interface OpenCodeDbSearchMessageRow {
  session_id: string;
  text: string;
}

interface OpenCodeDbSearchPartRow {
  id: string;
  message_id: string;
  time_created?: number;
  data: string;
}

interface OpenCodeDbMessageData {
  role?: string;
  parentID?: string;
  modelID?: string;
  time?: {
    created?: number;
    completed?: number;
  };
}

interface OpenCodeDbPartData {
  type?: string;
  text?: string;
  tool?: string;
  callID?: string;
  state?: OpenCodeToolState;
}

function toIsoTimestamp(timestampMs?: number): string | undefined {
  if (!timestampMs || Number.isNaN(timestampMs)) {
    return undefined;
  }

  return new Date(timestampMs).toISOString();
}

function normalizeToolInput(
  input: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!input) {
    return undefined;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    switch (key) {
      case "filePath":
        normalized.file_path = value;
        break;
      case "oldString":
        normalized.old_string = value;
        break;
      case "newString":
        normalized.new_string = value;
        break;
      default:
        normalized[key] = value;
    }
  }

  return normalized;
}

function stringifyToolOutput(output: unknown): string {
  if (output === undefined || output === null) {
    return "";
  }

  if (typeof output === "string") {
    return output;
  }

  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

async function getOpenCodeSessionFiles(): Promise<string[]> {
  return getFilesRecursively(openCodeSessionDir(), (filePath) =>
    filePath.endsWith(".json"),
  );
}

async function getOpenCodeSessionsFromFiles(): Promise<Session[]> {
  const files = await getOpenCodeSessionFiles();
  const sessions: Session[] = [];

  await Promise.all(
    files.map(async (filePath) => {
      const sessionFile = await readJsonFile<OpenCodeSessionFile>(filePath);
      if (!sessionFile?.id) {
        return;
      }

      const projectPath = sessionFile.directory ?? "";
      const timestamp =
        sessionFile.time?.updated ?? sessionFile.time?.created ?? 0;

      sessions.push({
        id: createSessionId("opencode", sessionFile.id),
        sourceId: sessionFile.id,
        provider: "opencode",
        display: sessionFile.title || `Session ${sessionFile.id.slice(0, 8)}`,
        timestamp,
        project: projectPath,
        projectName: projectPath ? getProjectName(projectPath) : "Unknown",
        transcriptPath: filePath,
        canResume: false,
      });
    }),
  );

  return sessions;
}

async function getOpenCodeSessionsFromDb(): Promise<Session[]> {
  const rows = await runSqliteJsonQuery<OpenCodeDbSessionRow>(
    "select id, title, directory, time_created, time_updated from session where time_archived is null order by time_updated desc",
  );

  return rows
    .filter((row) => Boolean(row.id))
    .map((row) => {
      const timestamp = row.time_updated ?? row.time_created ?? 0;
      const projectPath = row.directory ?? "";

      return {
        id: createSessionId("opencode", row.id),
        sourceId: row.id,
        provider: "opencode" as const,
        display: row.title || `Session ${row.id.slice(0, 8)}`,
        timestamp,
        project: projectPath,
        projectName: projectPath ? getProjectName(projectPath) : "Unknown",
        transcriptPath: `${openCodeDbPath}#session:${row.id}`,
        canResume: false,
      };
    });
}

async function getOpenCodeSessions(): Promise<Session[]> {
  try {
    const dbSessions = await getOpenCodeSessionsFromDb();
    if (dbSessions.length > 0) {
      return dbSessions;
    }
  } catch {
    // Fall back to filesystem storage when DB is unavailable or malformed.
  }

  return getOpenCodeSessionsFromFiles();
}

export async function getOpenCodeTranscriptSearchText(
  sourceId: string,
): Promise<string | null> {
  let dbMtime = 0;
  try {
    dbMtime = (await stat(openCodeDbPath)).mtimeMs;
  } catch {
    return null;
  }

  if (openCodeSearchTextCache && openCodeSearchTextCacheMtime === dbMtime) {
    return openCodeSearchTextCache.get(sourceId) ?? "";
  }

  if (!openCodeSearchTextCachePromise) {
    openCodeSearchTextCachePromise = (async () => {
      const rows = await runSqliteJsonQuery<OpenCodeDbSearchMessageRow>(
        "select m.session_id as session_id, group_concat(json_extract(p.data, '$.text'), '\\n') as text from message m join part p on p.message_id = m.id where json_extract(m.data, '$.role') in ('user', 'assistant') and json_extract(p.data, '$.type') in ('text', 'reasoning') and json_extract(p.data, '$.text') is not null and length(trim(json_extract(p.data, '$.text'))) > 0 group by m.session_id",
      );

      const nextCache = new Map<string, string>();
      for (const row of rows) {
        if (!row.session_id) {
          continue;
        }
        nextCache.set(row.session_id, row.text ?? "");
      }

      openCodeSearchTextCache = nextCache;
      openCodeSearchTextCacheMtime = dbMtime;
    })()
      .catch((error) => {
        console.error("Error loading OpenCode search text cache:", error);
        openCodeSearchTextCache = new Map<string, string>();
        openCodeSearchTextCacheMtime = dbMtime;
      })
      .finally(() => {
        openCodeSearchTextCachePromise = null;
      });
  }

  await openCodeSearchTextCachePromise;
  return openCodeSearchTextCache?.get(sourceId) ?? "";
}

async function getOpenCodeMessages(
  sourceId: string,
): Promise<OpenCodeMessageFile[]> {
  const messageDir = join(openCodeMessageDir(), sourceId);
  const files = await getFilesRecursively(messageDir, (filePath) =>
    filePath.endsWith(".json"),
  );

  const messages = await Promise.all(
    files.map(async (filePath) => readJsonFile<OpenCodeMessageFile>(filePath)),
  );

  return messages
    .filter((m): m is OpenCodeMessageFile => Boolean(m?.id))
    .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0));
}

async function getOpenCodeMessageParts(
  messageId: string,
): Promise<OpenCodePartFile[]> {
  const partDir = join(openCodePartDir(), messageId);
  const files = await getFilesRecursively(partDir, (filePath) =>
    filePath.endsWith(".json"),
  );

  const parts = await Promise.all(
    files.map(async (filePath) => readJsonFile<OpenCodePartFile>(filePath)),
  );

  return parts
    .filter((p): p is OpenCodePartFile => Boolean(p?.id && p?.type))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function partsToContentBlocks(parts: OpenCodePartFile[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  for (const part of parts) {
    if (part.type === "text" && part.text) {
      blocks.push({ type: "text", text: part.text });
      continue;
    }

    if (part.type === "reasoning" && part.text) {
      blocks.push({ type: "thinking", thinking: part.text });
      continue;
    }

    if (part.type === "tool" && part.tool) {
      const toolUseId = part.callID || part.id;
      blocks.push({
        type: "tool_use",
        id: toolUseId,
        name: part.tool,
        input: normalizeToolInput(part.state?.input),
      });

      const output = stringifyToolOutput(part.state?.output);
      if (output || part.state?.status) {
        blocks.push({
          type: "tool_result",
          tool_use_id: toolUseId,
          content: output,
          is_error: part.state?.status === "failed",
        });
      }
    }
  }

  return blocks;
}

async function getOpenCodeConversationFromFiles(
  sourceId: string,
): Promise<ConversationMessage[]> {
  const messages = await getOpenCodeMessages(sourceId);
  const conversation: ConversationMessage[] = [];

  for (const message of messages) {
    const role =
      message.role === "assistant"
        ? "assistant"
        : message.role === "user"
          ? "user"
          : null;
    if (!role) {
      continue;
    }

    const parts = await getOpenCodeMessageParts(message.id);
    const contentBlocks = partsToContentBlocks(parts);

    if (contentBlocks.length === 0) {
      continue;
    }

    conversation.push({
      type: role,
      uuid: message.id,
      parentUuid: message.parentID,
      timestamp: toIsoTimestamp(message.time?.created),
      message: {
        role,
        content: contentBlocks,
        model: message.modelID,
      },
    });
  }

  return conversation;
}

async function getOpenCodeConversationFromDb(
  sourceId: string,
): Promise<ConversationMessage[] | null> {
  let dbMtime = 0;
  try {
    dbMtime = (await stat(openCodeDbPath)).mtimeMs;
  } catch {
    return null;
  }

  if (
    !openCodeConversationCache ||
    openCodeConversationCacheMtime !== dbMtime
  ) {
    openCodeConversationCache = new Map<string, ConversationMessage[]>();
    openCodeConversationCacheMtime = dbMtime;
  }

  if (openCodeConversationCache.has(sourceId)) {
    return openCodeConversationCache.get(sourceId) ?? [];
  }

  const escapedSessionId = sourceId.replace(/'/g, "''");
  const messages = await runSqliteJsonQuery<OpenCodeDbMessageRow>(
    `select id, session_id, time_created, time_updated, data from message where session_id = '${escapedSessionId}' order by time_created asc`,
  );

  if (messages.length === 0) {
    openCodeConversationCache.set(sourceId, []);
    return [];
  }

  const parts = await runSqliteJsonQuery<OpenCodeDbPartRow>(
    `select id, message_id, session_id, time_created, time_updated, data from part where session_id = '${escapedSessionId}' order by time_created asc`,
  );

  const partsByMessageId = new Map<
    string,
    Array<{ part: OpenCodePartFile; timeCreated: number }>
  >();

  for (const row of parts) {
    let partData: OpenCodeDbPartData;
    try {
      partData = JSON.parse(row.data) as OpenCodeDbPartData;
    } catch {
      continue;
    }

    if (!partData.type) {
      continue;
    }

    const converted: OpenCodePartFile = {
      id: row.id,
      messageID: row.message_id,
      sessionID: row.session_id,
      type: partData.type,
      text: partData.text,
      tool: partData.tool,
      callID: partData.callID,
      state: partData.state,
    };

    const bucket = partsByMessageId.get(row.message_id) ?? [];
    bucket.push({ part: converted, timeCreated: row.time_created ?? 0 });
    partsByMessageId.set(row.message_id, bucket);
  }

  const conversation: ConversationMessage[] = [];

  for (const messageRow of messages) {
    let messageData: OpenCodeDbMessageData;
    try {
      messageData = JSON.parse(messageRow.data) as OpenCodeDbMessageData;
    } catch {
      continue;
    }

    const role =
      messageData.role === "assistant"
        ? "assistant"
        : messageData.role === "user"
          ? "user"
          : null;
    if (!role) {
      continue;
    }

    const messageParts = (partsByMessageId.get(messageRow.id) ?? [])
      .sort((a, b) => {
        if (a.timeCreated !== b.timeCreated) {
          return a.timeCreated - b.timeCreated;
        }
        return a.part.id.localeCompare(b.part.id);
      })
      .map((entry) => entry.part);

    const contentBlocks = partsToContentBlocks(messageParts);
    if (contentBlocks.length === 0) {
      continue;
    }

    conversation.push({
      type: role,
      uuid: messageRow.id,
      parentUuid: messageData.parentID,
      timestamp: toIsoTimestamp(
        messageData.time?.created ?? messageRow.time_created ?? undefined,
      ),
      message: {
        role,
        content: contentBlocks,
        model: messageData.modelID,
      },
    });
  }

  openCodeConversationCache.set(sourceId, conversation);
  return conversation;
}

async function getOpenCodeConversation(
  sourceId: string,
): Promise<ConversationMessage[]> {
  try {
    const fromDb = await getOpenCodeConversationFromDb(sourceId);
    if (fromDb !== null) {
      return fromDb;
    }
  } catch {
    // Fall back to filesystem storage when DB is unavailable or malformed.
  }

  return getOpenCodeConversationFromFiles(sourceId);
}

export async function loadStorage(): Promise<void> {
  await Promise.all([buildClaudeFileIndex(), loadHistoryCache()]);
}

async function getClaudeSessions(): Promise<Session[]> {
  const entries = historyCache ?? (await loadHistoryCache());
  const sessions: Session[] = [];
  const seenIds = new Set<string>();

  for (const entry of entries) {
    let sourceId = entry.sessionId;
    if (!sourceId) {
      const encodedProject = encodeProjectPath(entry.project);
      sourceId = await findClaudeSessionByTimestamp(
        encodedProject,
        entry.timestamp,
      );
    }

    if (!sourceId || seenIds.has(sourceId)) {
      continue;
    }

    seenIds.add(sourceId);
    sessions.push({
      id: createSessionId("claude", sourceId),
      sourceId,
      provider: "claude",
      display: entry.display,
      timestamp: entry.timestamp,
      project: entry.project,
      projectName: getProjectName(entry.project),
      transcriptPath: claudeFileIndex.get(sourceId),
      canResume: true,
    });
  }

  return sessions;
}

function sortSessions(sessions: Session[]): Session[] {
  return sessions.sort((a, b) => b.timestamp - a.timestamp);
}

export async function getSessions(
  provider: SessionProvider | "all" = "all",
): Promise<Session[]> {
  return dedupe(`getSessions:${provider}`, async () => {
    const providers = provider === "all" ? SESSION_PROVIDERS : [provider];
    const collections = await Promise.all(
      providers.map(async (activeProvider) => {
        switch (activeProvider) {
          case "claude":
            return getClaudeSessions();
          case "codex":
            return getCodexSessions();
          case "opencode":
            return getOpenCodeSessions();
          case "cursor":
            return getCursorSessions();
          default:
            return [];
        }
      }),
    );

    return sortSessions(collections.flat());
  });
}

export async function getProjects(
  provider: SessionProvider | "all" = "all",
): Promise<string[]> {
  const sessions = await getSessions(provider);
  const projects = new Set<string>();

  for (const session of sessions) {
    if (session.project) {
      projects.add(session.project);
    }
  }

  return [...projects].sort();
}

export async function searchSessions(
  query: string,
  provider: SessionProvider | "all" = "all",
): Promise<Session[]> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return getSessions(provider);
  }

  const sessions = await getSessions(provider);
  const directMatches: Session[] = [];
  const unresolved: Session[] = [];

  for (const session of sessions) {
    const haystack =
      `${session.display}\n${session.projectName}\n${session.project}`.toLowerCase();
    if (haystack.includes(normalizedQuery)) {
      directMatches.push(session);
      continue;
    }
    unresolved.push(session);
  }

  const transcriptMatches: Session[] = [];

  for (
    let start = 0;
    start < unresolved.length;
    start += TRANSCRIPT_SEARCH_CHUNK_SIZE
  ) {
    const chunk = unresolved.slice(start, start + TRANSCRIPT_SEARCH_CHUNK_SIZE);
    const chunkMatches = await Promise.all(
      chunk.map(async (session) => {
        if (session.provider === "opencode") {
          const openCodeText = await getOpenCodeTranscriptSearchText(
            session.sourceId,
          );
          const haystack =
            `${session.display}\n${session.projectName}\n${session.project}\n${openCodeText ?? ""}`.toLowerCase();
          return haystack.includes(normalizedQuery) ? session : null;
        }

        const messages = await getConversation(session.id);
        const text = messages
          .map((message) => messageToSearchText(message))
          .join("\n")
          .toLowerCase();
        return text.includes(normalizedQuery) ? session : null;
      }),
    );

    for (const match of chunkMatches) {
      if (match) {
        transcriptMatches.push(match);
      }
    }
  }

  return sortSessions([...directMatches, ...transcriptMatches]);
}

async function getClaudeConversation(
  sourceId: string,
): Promise<ConversationMessage[]> {
  const filePath = await findClaudeSessionFile(sourceId);

  if (!filePath) {
    return [];
  }

  const messages: ConversationMessage[] = [];

  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const msg: ConversationMessage = JSON.parse(line);
        if (msg.type === "user" || msg.type === "assistant") {
          messages.push(msg);
        } else if (msg.type === "summary") {
          messages.unshift(msg);
        }
      } catch {
        // Skip malformed lines.
      }
    }
  } catch (err) {
    console.error("Error reading Claude conversation:", err);
  }

  return messages;
}

export async function getConversation(
  sessionId: string,
): Promise<ConversationMessage[]> {
  const { provider, sourceId } = parseSessionId(sessionId);

  return dedupe(`getConversation:${provider}:${sourceId}`, async () => {
    switch (provider) {
      case "claude":
        return getClaudeConversation(sourceId);
      case "codex":
        return getCodexConversation(sourceId);
      case "opencode":
        return getOpenCodeConversation(sourceId);
      case "cursor":
        return getCursorConversation(sourceId);
      default:
        return [];
    }
  });
}

async function getClaudeConversationStream(
  sourceId: string,
  fromOffset: number = 0,
): Promise<StreamResult> {
  const filePath = await findClaudeSessionFile(sourceId);

  if (!filePath) {
    return { messages: [], nextOffset: 0 };
  }

  const messages: ConversationMessage[] = [];

  let fileHandle;
  try {
    const fileStat = await stat(filePath);
    const fileSize = fileStat.size;

    if (fromOffset >= fileSize) {
      return { messages: [], nextOffset: fromOffset };
    }

    fileHandle = await open(filePath, "r");
    const stream = fileHandle.createReadStream({
      start: fromOffset,
      encoding: "utf-8",
    });

    const rl = createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    let bytesConsumed = 0;

    for await (const line of rl) {
      const lineBytes = Buffer.byteLength(line, "utf-8") + 1;

      if (line.trim()) {
        try {
          const msg: ConversationMessage = JSON.parse(line);
          if (msg.type === "user" || msg.type === "assistant") {
            messages.push(msg);
          }
          bytesConsumed += lineBytes;
        } catch {
          break;
        }
      } else {
        bytesConsumed += lineBytes;
      }
    }

    const actualOffset = fromOffset + bytesConsumed;
    const nextOffset = actualOffset > fileSize ? fileSize : actualOffset;

    return { messages, nextOffset };
  } catch (err) {
    console.error("Error reading Claude conversation stream:", err);
    return { messages: [], nextOffset: fromOffset };
  } finally {
    if (fileHandle) {
      await fileHandle.close();
    }
  }
}

export async function getConversationStream(
  sessionId: string,
  fromOffset: number = 0,
): Promise<StreamResult> {
  const { provider, sourceId } = parseSessionId(sessionId);

  if (provider !== "claude") {
    return { messages: [], nextOffset: fromOffset };
  }

  return getClaudeConversationStream(sourceId, fromOffset);
}
