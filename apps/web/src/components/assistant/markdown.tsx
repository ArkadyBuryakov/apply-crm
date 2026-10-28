import { useRouter } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** Assistant replies. Links into the app navigate in place; other links open in a new tab. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const router = useRouter();
  return (
    <div className={cn("grid gap-2 text-sm leading-relaxed [overflow-wrap:anywhere]", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const internal = href?.startsWith("/") && !href.startsWith("//");
            return (
              <a
                href={href}
                className="text-primary hover:underline"
                {...(internal
                  ? {
                      onClick: (e) => {
                        e.preventDefault();
                        router.history.push(href!);
                      },
                    }
                  : { target: "_blank", rel: "noreferrer" })}
              >
                {children}
              </a>
            );
          },
          ul: (props) => <ul className="ml-5 list-disc space-y-1" {...strip(props)} />,
          ol: (props) => <ol className="ml-5 list-decimal space-y-1" {...strip(props)} />,
          h1: (props) => <h3 className="font-semibold" {...strip(props)} />,
          h2: (props) => <h3 className="font-semibold" {...strip(props)} />,
          h3: (props) => <h3 className="font-semibold" {...strip(props)} />,
          blockquote: (props) => (
            <blockquote className="border-l-2 border-border pl-3 text-muted-foreground" {...strip(props)} />
          ),
          pre: (props) => (
            <pre
              className="overflow-x-auto rounded-md bg-muted p-2 text-xs [&_code]:bg-transparent"
              {...strip(props)}
            />
          ),
          code: (props) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...strip(props)} />,
          table: (props) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs" {...strip(props)} />
            </div>
          ),
          th: (props) => <th className="border border-border px-2 py-1 text-left font-medium" {...strip(props)} />,
          td: (props) => <td className="border border-border px-2 py-1 align-top" {...strip(props)} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** react-markdown passes its AST node along; it must not reach the DOM. */
function strip<T extends { node?: unknown }>({ node: _node, ...props }: T): Omit<T, "node"> {
  return props;
}

export type MarkdownProps = ComponentProps<typeof Markdown>;
