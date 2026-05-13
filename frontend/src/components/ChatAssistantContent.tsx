import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { splitAssistantMessage } from '@/lib/assistant-message-split';
import { remarkUnwrapOrderedListsNotStartingAtOne } from '@/lib/remark-unwrap-ordered-lists-not-starting-at-one';

function ChatMarkdown({ children }: { children: string }) {
  if (!children.trim()) return null;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkUnwrapOrderedListsNotStartingAtOne]}
      components={{
        p: ({ children: c }) => <p className="mb-2 last:mb-0 leading-relaxed">{c}</p>,
        strong: ({ children: c }) => <strong className="font-semibold text-foreground">{c}</strong>,
        em: ({ children: c }) => <em className="italic">{c}</em>,
        ul: ({ children: c }) => <ul className="mb-2 list-disc pl-5 last:mb-0">{c}</ul>,
        ol: ({ children: c }) => <ol className="mb-2 list-decimal pl-5 last:mb-0">{c}</ol>,
        li: ({ children: c }) => <li className="mb-0.5">{c}</li>,
        h1: ({ children: c }) => <h1 className="mb-2 text-base font-semibold">{c}</h1>,
        h2: ({ children: c }) => <h2 className="mb-2 text-sm font-semibold">{c}</h2>,
        h3: ({ children: c }) => <h3 className="mb-1 text-sm font-semibold">{c}</h3>,
        a: ({ href, children: c }) => (
          <a
            href={href}
            className="text-primary underline underline-offset-2 hover:opacity-90"
            target="_blank"
            rel="noreferrer"
          >
            {c}
          </a>
        ),
        blockquote: ({ children: c }) => (
          <blockquote className="mb-2 border-l-2 border-muted-foreground/40 pl-3 text-muted-foreground">
            {c}
          </blockquote>
        ),
        hr: () => <hr className="my-3 border-border" />,
        code: ({ className, children: c, ...props }) => {
          const inline = !className;
          if (inline) {
            return (
              <code
                className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
                {...props}
              >
                {c}
              </code>
            );
          }
          return (
            <pre className="mb-2 max-h-64 overflow-auto rounded-md bg-muted p-2 text-xs">
              <code className="font-mono text-foreground" {...props}>
                {c}
              </code>
            </pre>
          );
        },
        table: ({ children: c }) => (
          <div className="mb-2 max-w-full overflow-x-auto">
            <table className="w-full border-collapse border border-border text-xs">{c}</table>
          </div>
        ),
        thead: ({ children: c }) => <thead className="bg-muted/60">{c}</thead>,
        th: ({ children: c }) => (
          <th className="border border-border px-2 py-1 text-left font-semibold">{c}</th>
        ),
        td: ({ children: c }) => <td className="border border-border px-2 py-1 align-top">{c}</td>,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

export function ChatAssistantContent(props: {
  thinkingLabel: string;
  /** Persisted assistant message */
  content?: string;
  /** Live NDJSON stream buffers */
  streamReasoning?: string;
  streamText?: string;
  isStreaming?: boolean;
}) {
  const rawFromStream = [
    props.streamReasoning?.trim() && `<thinking>\n${props.streamReasoning.trim()}\n</thinking>`,
    props.streamText ?? '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const raw = props.content ?? rawFromStream;

  const { thinking, body } = splitAssistantMessage(raw, {
    partialThinking: Boolean(props.isStreaming),
  });

  return (
    <div className="assistant-message-markdown text-[14px] leading-[1.65]">
      {thinking ? (
        <details
          className="mb-2 rounded-md border border-border bg-card text-muted-foreground overflow-hidden"
          open={Boolean(props.isStreaming)}
        >
          <summary className="cursor-pointer select-none px-3 py-2 text-[12.5px] font-medium text-muted-foreground hover:bg-muted">
            {props.thinkingLabel}
          </summary>
          <div className="max-h-[min(40vh,22rem)] overflow-y-auto border-t border-border px-3 py-2 text-[12.5px] leading-relaxed">
            <ChatMarkdown>{thinking}</ChatMarkdown>
          </div>
        </details>
      ) : null}
      <div className="text-foreground">
        <ChatMarkdown>{body}</ChatMarkdown>
        {props.isStreaming ? (
          <span
            className="inline-flex items-center gap-0.5 ml-1 align-middle translate-y-px"
            aria-hidden
          >
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
          </span>
        ) : null}
      </div>
    </div>
  );
}
