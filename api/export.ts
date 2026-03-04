import { chromium, type Browser } from "playwright";
import type { ConversationMessage, ContentBlock, Session } from "./storage";

export type ExportFormat = "markdown" | "html" | "pdf";

interface ExportToolItem {
  type: "tool_use" | "tool_result" | "thinking";
  title: string;
  detail: string;
  isError?: boolean;
}

interface ExportMessage {
  role: "user" | "assistant";
  text: string;
  tools: ExportToolItem[];
  timestamp?: string;
}

interface ExportDocument {
  session: Session;
  summary: string;
  messages: ExportMessage[];
}

let pdfBrowserPromise: Promise<Browser> | null = null;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function stringifyUnknown(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function summarizeToolInput(input: unknown): string {
  const serialized = stringifyUnknown(input);
  return serialized.length > 240
    ? `${serialized.slice(0, 240)}...`
    : serialized;
}

function summarizeToolResultContent(content: string): string {
  const normalized = normalizeWhitespace(content);
  return normalized.length > 320
    ? `${normalized.slice(0, 320)}...`
    : normalized;
}

function flattenToolResultContent(content: string | ContentBlock[]): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((block) => {
      if (block.type === "text") {
        return block.text ?? "";
      }
      if (block.type === "thinking") {
        return block.thinking ?? "";
      }
      if (block.type === "tool_result") {
        if (!block.content) {
          return "";
        }
        return typeof block.content === "string"
          ? block.content
          : flattenToolResultContent(block.content);
      }
      if (block.type === "tool_use") {
        return [
          block.name ?? "tool",
          block.input ? stringifyUnknown(block.input) : "",
        ]
          .filter(Boolean)
          .join(" ");
      }
      return "";
    })
    .join("\n");
}

function parseMessageContent(message: ConversationMessage): {
  text: string;
  tools: ExportToolItem[];
} {
  const content = message.message?.content;
  if (!content) {
    return { text: "", tools: [] };
  }

  if (typeof content === "string") {
    return { text: normalizeWhitespace(content), tools: [] };
  }

  const textParts: string[] = [];
  const tools: ExportToolItem[] = [];

  for (const block of content) {
    if (block.type === "text") {
      const text = normalizeWhitespace(block.text ?? "");
      if (text) {
        textParts.push(text);
      }
      continue;
    }

    if (block.type === "thinking") {
      const thinking = normalizeWhitespace(block.thinking ?? "");
      if (thinking) {
        tools.push({
          type: "thinking",
          title: "Thinking",
          detail: summarizeToolResultContent(thinking),
        });
      }
      continue;
    }

    if (block.type === "tool_use") {
      tools.push({
        type: "tool_use",
        title: `Tool: ${block.name ?? "unknown"}`,
        detail: summarizeToolInput(block.input),
      });
      continue;
    }

    if (block.type === "tool_result") {
      if (!block.content) {
        tools.push({
          type: "tool_result",
          title: block.is_error ? "Tool result (error)" : "Tool result",
          detail: "Completed with no additional output",
          isError: block.is_error,
        });
        continue;
      }

      const resultText = summarizeToolResultContent(
        flattenToolResultContent(block.content),
      );
      tools.push({
        type: "tool_result",
        title: block.is_error ? "Tool result (error)" : "Tool result",
        detail: resultText || "Completed",
        isError: block.is_error,
      });
    }
  }

  return {
    text: textParts.join("\n\n").trim(),
    tools,
  };
}

function buildExportDocument(
  session: Session,
  messages: ConversationMessage[],
): ExportDocument {
  const summaryMessage = messages.find((message) => message.type === "summary");

  const normalizedMessages: ExportMessage[] = messages
    .filter(
      (message) => message.type === "user" || message.type === "assistant",
    )
    .map((message) => {
      const parsed = parseMessageContent(message);
      return {
        role: message.type === "user" ? "user" : "assistant",
        text: parsed.text,
        tools: parsed.tools,
        timestamp: message.timestamp,
      };
    });

  return {
    session,
    summary: normalizeWhitespace(summaryMessage?.summary ?? ""),
    messages: normalizedMessages,
  };
}

function toMarkdown(document: ExportDocument): string {
  const lines: string[] = [];
  lines.push(`# ${document.session.display || "Chat Export"}`);
  lines.push("");
  lines.push(`- Provider: ${document.session.provider}`);
  lines.push(`- Project: ${document.session.projectName}`);
  lines.push(
    `- Timestamp: ${new Date(document.session.timestamp).toISOString()}`,
  );
  lines.push(`- Session ID: ${document.session.sourceId}`);
  if (document.session.transcriptPath) {
    lines.push(`- Transcript Path: ${document.session.transcriptPath}`);
  }
  lines.push("");

  if (document.summary) {
    lines.push("## Summary");
    lines.push("");
    lines.push(document.summary);
    lines.push("");
  }

  lines.push("## Conversation");
  lines.push("");

  for (let index = 0; index < document.messages.length; index++) {
    const message = document.messages[index];
    const roleLabel = message.role === "user" ? "User" : "Assistant";
    lines.push(`### ${index + 1}. ${roleLabel}`);
    if (message.timestamp) {
      lines.push(`_Timestamp: ${message.timestamp}_`);
      lines.push("");
    }

    if (message.text) {
      lines.push(message.text);
      lines.push("");
    }

    if (message.tools.length > 0) {
      lines.push("#### Tool Activity");
      lines.push("");
      for (const tool of message.tools) {
        const prefix = tool.isError ? "ERROR" : "INFO";
        lines.push(`- [${prefix}] ${tool.title}: ${tool.detail}`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

function toHtml(document: ExportDocument): string {
  const messageSections = document.messages
    .map((message, index) => {
      const roleLabel = message.role === "user" ? "User" : "Assistant";
      const toolMarkup =
        message.tools.length > 0
          ? `<div class="tool-list"><h4>Tool Activity</h4><ul>${message.tools
              .map(
                (tool) =>
                  `<li><span class="badge ${tool.isError ? "error" : "ok"}">${tool.isError ? "ERROR" : "INFO"}</span><strong>${escapeHtml(tool.title)}</strong><div class="tool-detail">${escapeHtml(tool.detail)}</div></li>`,
              )
              .join("")}</ul></div>`
          : "";

      return `<section class="message ${message.role}"><h3>${index + 1}. ${roleLabel}</h3>${message.timestamp ? `<p class="timestamp">${escapeHtml(message.timestamp)}</p>` : ""}${message.text ? `<pre class="message-text">${escapeHtml(message.text)}</pre>` : ""}${toolMarkup}</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(document.session.display || "Chat Export")}</title>
    <style>
      :root {
        color-scheme: dark;
      }
      body {
        margin: 0;
        padding: 0;
        background: #1a1f23;
        color: #f7f9fb;
        font-family: "DM Sans", "Segoe UI", sans-serif;
      }
      main {
        max-width: 920px;
        margin: 0 auto;
        padding: 24px;
      }
      .meta {
        background: #1e2327;
        border: 1px solid #2b3238;
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 20px;
      }
      .meta ul {
        margin: 0;
        padding-left: 18px;
      }
      .summary {
        background: #1e2327;
        border: 1px solid #2b3238;
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 20px;
      }
      .message {
        background: #1e2327;
        border: 1px solid #2b3238;
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 12px;
      }
      .message.user {
        border-color: rgba(36, 174, 29, 0.45);
      }
      .timestamp {
        color: #86919d;
        font-size: 12px;
      }
      .message-text {
        white-space: pre-wrap;
        background: #111111;
        border-radius: 8px;
        border: 1px solid #2b3238;
        padding: 12px;
      }
      .tool-list h4 {
        margin-bottom: 8px;
      }
      .tool-list ul {
        margin: 0;
        padding-left: 18px;
      }
      .tool-list li {
        margin-bottom: 8px;
      }
      .badge {
        display: inline-block;
        margin-right: 8px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
      }
      .badge.ok {
        color: #89df00;
      }
      .badge.error {
        color: #e63946;
      }
      .tool-detail {
        margin-top: 4px;
        color: #c3cbd2;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(document.session.display || "Chat Export")}</h1>
      <section class="meta">
        <ul>
          <li><strong>Provider:</strong> ${escapeHtml(document.session.provider)}</li>
          <li><strong>Project:</strong> ${escapeHtml(document.session.projectName)}</li>
          <li><strong>Timestamp:</strong> ${escapeHtml(new Date(document.session.timestamp).toISOString())}</li>
          <li><strong>Session ID:</strong> ${escapeHtml(document.session.sourceId)}</li>
          ${document.session.transcriptPath ? `<li><strong>Transcript Path:</strong> ${escapeHtml(document.session.transcriptPath)}</li>` : ""}
        </ul>
      </section>
      ${document.summary ? `<section class="summary"><h2>Summary</h2><p>${escapeHtml(document.summary)}</p></section>` : ""}
      <section>
        <h2>Conversation</h2>
        ${messageSections}
      </section>
    </main>
  </body>
</html>`;
}

async function getPdfBrowser(): Promise<Browser> {
  if (!pdfBrowserPromise) {
    pdfBrowserPromise = chromium.launch({ headless: true });
  }
  return pdfBrowserPromise;
}

async function toPdf(document: ExportDocument): Promise<Buffer> {
  const html = toHtml(document);
  const browser = await getPdfBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.emulateMedia({ media: "screen", colorScheme: "dark" });
    const output = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "16mm",
        right: "12mm",
        bottom: "16mm",
        left: "12mm",
      },
      preferCSSPageSize: true,
    });
    return Buffer.from(output);
  } finally {
    await page.close();
  }
}

function sanitizeFileName(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "chat-export";
}

export function getExportFileName(
  session: Session,
  format: ExportFormat,
): string {
  const base = sanitizeFileName(session.display || `${session.provider}-chat`);
  const suffix = new Date(session.timestamp).toISOString().replace(/[:]/g, "-");
  const extension = format === "markdown" ? "md" : format;
  return `${base}-${suffix}.${extension}`;
}

export async function exportConversation(
  session: Session,
  messages: ConversationMessage[],
  format: ExportFormat,
): Promise<{ mimeType: string; content: string | Buffer }> {
  const document = buildExportDocument(session, messages);

  if (format === "markdown") {
    return {
      mimeType: "text/markdown; charset=utf-8",
      content: toMarkdown(document),
    };
  }

  if (format === "html") {
    return {
      mimeType: "text/html; charset=utf-8",
      content: toHtml(document),
    };
  }

  return {
    mimeType: "application/pdf",
    content: await toPdf(document),
  };
}

process.once("exit", () => {
  if (pdfBrowserPromise) {
    void pdfBrowserPromise.then((browser) => browser.close()).catch(() => {});
  }
});
