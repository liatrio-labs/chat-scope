import { homedir } from "os";
import { join } from "path";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import type { SessionProvider } from "./storage";

const STORE_SCHEMA_VERSION = 1;
const indexRootDir = join(homedir(), ".local", "share", "chat-scope", "index");
const indexFilePath = join(indexRootDir, "search-index.json");

export interface PersistedIndexedDocument {
  sessionId: string;
  provider: SessionProvider;
  fingerprint: string;
  text: string;
}

interface PersistedIndexPayload {
  schemaVersion: number;
  savedAt: number;
  documents: PersistedIndexedDocument[];
}

export interface LoadedIndex {
  savedAt: number;
  documents: PersistedIndexedDocument[];
}

export async function loadPersistedIndex(): Promise<LoadedIndex | null> {
  try {
    const raw = await readFile(indexFilePath, "utf-8");
    const parsed = JSON.parse(raw) as PersistedIndexPayload;
    if (parsed.schemaVersion !== STORE_SCHEMA_VERSION) {
      return null;
    }

    if (!Array.isArray(parsed.documents)) {
      return null;
    }

    return {
      savedAt: parsed.savedAt ?? Date.now(),
      documents: parsed.documents.filter(
        (document): document is PersistedIndexedDocument =>
          Boolean(
            document &&
            typeof document.sessionId === "string" &&
            typeof document.provider === "string" &&
            typeof document.fingerprint === "string" &&
            typeof document.text === "string",
          ),
      ),
    };
  } catch {
    return null;
  }
}

export async function persistIndex(
  documents: PersistedIndexedDocument[],
): Promise<void> {
  await mkdir(indexRootDir, { recursive: true });

  const payload: PersistedIndexPayload = {
    schemaVersion: STORE_SCHEMA_VERSION,
    savedAt: Date.now(),
    documents,
  };

  const tmpPath = `${indexFilePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(payload), "utf-8");
  await rename(tmpPath, indexFilePath);
}
