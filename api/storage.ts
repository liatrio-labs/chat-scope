import { readdir, readFile, stat, open } from "fs/promises";
import { join, basename } from "path";
import { homedir } from "os";
import { createInterface } from "readline";

export type SessionProvider = "claude" | "codex" | "opencode";
export const SESSION_PROVIDERS: SessionProvider[] = ["claude", "codex", "opencode"];

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

const CLAUDE_PROVIDER: SessionProvider = "claude";
const SESSION_ID_SEPARATOR = ":";

let claudeDir = join(homedir(), ".claude");
let projectsDir = join(claudeDir, "projects");
let codexSessionsDir = join(homedir(), ".codex", "sessions");
let openCodeStorageDir = join(homedir(), ".local", "share", "opencode", "storage");

const openCodeSessionDir = () => join(openCodeStorageDir, "session");
const openCodeMessageDir = () => join(openCodeStorageDir, "message");
const openCodePartDir = () => join(openCodeStorageDir, "part");

const claudeFileIndex = new Map<string, string>();
const codexFileIndex = new Map<string, string>();
let historyCache: HistoryEntry[] | null = null;
const pendingRequests = new Map<string, Promise<unknown>>();

export function initStorage(dir?: string): void {
  claudeDir = dir ?? join(homedir(), ".claude");
  projectsDir = join(claudeDir, "projects");
  codexSessionsDir = join(homedir(), ".codex", "sessions");
  openCodeStorageDir = join(homedir(), ".local", "share", "opencode", "storage");
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

export function createSessionId(provider: SessionProvider, sourceId: string): string {
  return `${provider}${SESSION_ID_SEPARATOR}${sourceId}`;
}

function parseSessionId(sessionId: string): { provider: SessionProvider; sourceId: string } {
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

function getProviderFromQuery(provider?: string | null): SessionProvider | "all" {
  if (!provider || provider === "all") {
    return "all";
  }

  if (SESSION_PROVIDERS.includes(provider as SessionProvider)) {
    return provider as SessionProvider;
  }

  return "all";
}

export function normalizeProvider(provider?: string | null): SessionProvider | "all" {
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
  return getFilesRecursively(codexSessionsDir, (filePath) => filePath.endsWith(".jsonl"));
}

function parseCodexTimestamp(value?: string): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getTextFromCodexContent(content: Array<{ type?: string; text?: string }> | undefined): string {
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

async function getCodexConversation(sourceId: string): Promise<ConversationMessage[]> {
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

      messages.push(createSimpleMessage(role, text, record.payload.id, record.timestamp));
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

function toIsoTimestamp(timestampMs?: number): string | undefined {
  if (!timestampMs || Number.isNaN(timestampMs)) {
    return undefined;
  }

  return new Date(timestampMs).toISOString();
}

function normalizeToolInput(input: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
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
  return getFilesRecursively(openCodeSessionDir(), (filePath) => filePath.endsWith(".json"));
}

async function getOpenCodeSessions(): Promise<Session[]> {
  const files = await getOpenCodeSessionFiles();
  const sessions: Session[] = [];

  await Promise.all(
    files.map(async (filePath) => {
      const sessionFile = await readJsonFile<OpenCodeSessionFile>(filePath);
      if (!sessionFile?.id) {
        return;
      }

      const projectPath = sessionFile.directory ?? "";
      const timestamp = sessionFile.time?.updated ?? sessionFile.time?.created ?? 0;

      sessions.push({
        id: createSessionId("opencode", sessionFile.id),
        sourceId: sessionFile.id,
        provider: "opencode",
        display: sessionFile.title || `Session ${sessionFile.id.slice(0, 8)}`,
        timestamp,
        project: projectPath,
        projectName: projectPath ? getProjectName(projectPath) : "Unknown",
        canResume: false,
      });
    }),
  );

  return sessions;
}

async function getOpenCodeMessages(sourceId: string): Promise<OpenCodeMessageFile[]> {
  const messageDir = join(openCodeMessageDir(), sourceId);
  const files = await getFilesRecursively(messageDir, (filePath) => filePath.endsWith(".json"));

  const messages = await Promise.all(files.map(async (filePath) => readJsonFile<OpenCodeMessageFile>(filePath)));

  return messages
    .filter((m): m is OpenCodeMessageFile => Boolean(m?.id))
    .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0));
}

async function getOpenCodeMessageParts(messageId: string): Promise<OpenCodePartFile[]> {
  const partDir = join(openCodePartDir(), messageId);
  const files = await getFilesRecursively(partDir, (filePath) => filePath.endsWith(".json"));

  const parts = await Promise.all(files.map(async (filePath) => readJsonFile<OpenCodePartFile>(filePath)));

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

async function getOpenCodeConversation(sourceId: string): Promise<ConversationMessage[]> {
  const messages = await getOpenCodeMessages(sourceId);
  const conversation: ConversationMessage[] = [];

  for (const message of messages) {
    const role = message.role === "assistant" ? "assistant" : message.role === "user" ? "user" : null;
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
      sourceId = await findClaudeSessionByTimestamp(encodedProject, entry.timestamp);
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
      canResume: true,
    });
  }

  return sessions;
}

function sortSessions(sessions: Session[]): Session[] {
  return sessions.sort((a, b) => b.timestamp - a.timestamp);
}

export async function getSessions(provider: SessionProvider | "all" = "all"): Promise<Session[]> {
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
          default:
            return [];
        }
      }),
    );

    return sortSessions(collections.flat());
  });
}

export async function getProjects(provider: SessionProvider | "all" = "all"): Promise<string[]> {
  const sessions = await getSessions(provider);
  const projects = new Set<string>();

  for (const session of sessions) {
    if (session.project) {
      projects.add(session.project);
    }
  }

  return [...projects].sort();
}

async function getClaudeConversation(sourceId: string): Promise<ConversationMessage[]> {
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

export async function getConversation(sessionId: string): Promise<ConversationMessage[]> {
  const { provider, sourceId } = parseSessionId(sessionId);

  return dedupe(`getConversation:${provider}:${sourceId}`, async () => {
    switch (provider) {
      case "claude":
        return getClaudeConversation(sourceId);
      case "codex":
        return getCodexConversation(sourceId);
      case "opencode":
        return getOpenCodeConversation(sourceId);
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
