import { memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "./tool-renderers";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer = memo(function MarkdownRenderer(
  props: MarkdownRendererProps,
) {
  const { content, className = "" } = props;

  return (
    <div className={`break-words ${className}`}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => {
            const { children } = props;
            return (
              <div className="text-3xl font-bold text-[var(--brand-text-primary)] mt-6 mb-3 leading-tight">
                {children}
              </div>
            );
          },
          h2: (props) => {
            const { children } = props;
            return (
              <div className="text-2xl font-semibold text-[var(--brand-text-primary)] mt-5 mb-2 leading-tight">
                {children}
              </div>
            );
          },
          h3: (props) => {
            const { children } = props;
            return (
              <div className="text-xl font-semibold text-[var(--brand-text-primary)] mt-4 mb-2 leading-tight">
                {children}
              </div>
            );
          },
          h4: (props) => {
            const { children } = props;
            return (
              <div className="text-lg font-medium text-[var(--brand-text-primary)] mt-3 mb-1">
                {children}
              </div>
            );
          },
          h5: (props) => {
            const { children } = props;
            return (
              <div className="text-base font-medium text-[var(--brand-text-primary)] mt-3 mb-1">
                {children}
              </div>
            );
          },
          h6: (props) => {
            const { children } = props;
            return (
              <div className="text-base font-medium text-[var(--brand-text-primary)] mt-3 mb-1">
                {children}
              </div>
            );
          },
          p: (props) => {
            const { children } = props;
            return (
              <p className="text-[16px] leading-relaxed text-[var(--brand-text-secondary)] whitespace-pre-wrap my-2">
                {children}
              </p>
            );
          },
          a: (props) => {
            const { href, children } = props;
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--brand-info)] hover:text-[var(--brand-highlight)] underline underline-offset-2"
              >
                {children}
              </a>
            );
          },
          strong: (props) => {
            const { children } = props;
            return (
              <strong className="font-semibold text-[var(--brand-text-primary)]">
                {children}
              </strong>
            );
          },
          em: (props) => {
            const { children } = props;
            return (
              <em className="italic text-[var(--brand-text-secondary)]">
                {children}
              </em>
            );
          },
          code: (props) => {
            const { children } = props;
            return (
              <code className="px-1.5 py-0.5 rounded bg-[var(--brand-bg-tertiary)] text-[var(--brand-highlight)] text-[12px] font-mono">
                {children}
              </code>
            );
          },
          pre: (props) => {
            const { node } = props as {
              node?: {
                children?: Array<{
                  tagName?: string;
                  properties?: { className?: string[] };
                  children?: Array<{ value?: string }>;
                }>;
              };
            };
            const codeNode = node?.children?.[0];

            if (codeNode?.tagName === "code") {
              const classNames = codeNode.properties?.className || [];
              const langClass = classNames.find((c) =>
                c.startsWith("language-"),
              );
              const language = langClass?.replace("language-", "") || "code";
              const codeContent =
                codeNode.children?.map((c) => c.value).join("") || "";

              return (
                <div className="relative group my-2 rounded-[10px] overflow-hidden border border-[var(--brand-border)]/70">
                  <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--brand-bg-tertiary)] border-b border-[var(--brand-border)]/70">
                    <span className="text-[10px] text-[var(--brand-text-muted)] font-mono">
                      {language}
                    </span>
                    <CopyButton text={codeContent} />
                  </div>
                  <pre className="text-xs text-[var(--brand-text-secondary)] bg-[var(--brand-bg-tertiary)]/90 p-3 overflow-x-auto rounded-t-none!">
                    <code>{codeContent}</code>
                  </pre>
                </div>
              );
            }

            const { children } = props;
            return <pre>{children}</pre>;
          },
          ul: (props) => {
            const { children } = props;
            return (
              <ul className="my-2 ml-3 space-y-1 list-disc list-inside text-[var(--brand-text-secondary)]">
                {children}
              </ul>
            );
          },
          ol: (props) => {
            const { children } = props;
            return (
              <ol className="my-2 ml-3 space-y-1 list-decimal list-inside text-[var(--brand-text-secondary)]">
                {children}
              </ol>
            );
          },
          li: (props) => {
            const { children } = props;
            return <li className="text-[16px] leading-relaxed">{children}</li>;
          },
          blockquote: (props) => {
            const { children } = props;
            return (
              <div className="border-l-2 border-[var(--brand-highlight)]/60 pl-3 my-2 text-[var(--brand-text-muted)] italic">
                {children}
              </div>
            );
          },
          hr: () => <hr className="border-[var(--brand-border)] my-4" />,
          table: (props) => {
            const { children } = props;
            return (
              <div className="my-2 overflow-x-auto rounded-[10px] border border-[var(--brand-border)]/70">
                <table className="w-full text-[13px]">{children}</table>
              </div>
            );
          },
          thead: (props) => {
            const { children } = props;
            return (
              <thead className="bg-[var(--brand-bg-tertiary)]">
                {children}
              </thead>
            );
          },
          tr: (props) => {
            const { children } = props;
            return (
              <tr className="border-b border-[var(--brand-border)]/60 last:border-b-0">
                {children}
              </tr>
            );
          },
          th: (props) => {
            const { children } = props;
            return (
              <th className="px-3 py-2 text-left font-medium text-[var(--brand-text-primary)]">
                {children}
              </th>
            );
          },
          td: (props) => {
            const { children } = props;
            return (
              <td className="px-3 py-2 text-[var(--brand-text-secondary)]">
                {children}
              </td>
            );
          },
        }}
      >
        {content}
      </Markdown>
    </div>
  );
});
