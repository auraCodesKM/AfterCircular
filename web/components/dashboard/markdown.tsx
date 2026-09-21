import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "cn";

/** Markdown from policies, memos and summaries — rendered with the app tokens (tables, lists, emphasis, code). */
const components: Components = {
  h1: ({ children }) => <h3 className="mt-3 mb-1 text-sm font-medium first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-3 mb-1 text-sm font-medium first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-2 mb-1 text-sm font-medium first:mt-0">{children}</h4>,
  h4: ({ children }) => <h5 className="mt-2 mb-1 text-xs font-medium tracking-wide uppercase text-muted-foreground first:mt-0">{children}</h5>,
  p: ({ children }) => <p className="my-1.5 leading-6 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-6">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-brand underline-offset-4 hover:underline">
      {children}
    </a>
  ),
  code: ({ children, className }) =>
    className ? (
      <code className={cn("block overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-xs", className)}>{children}</code>
    ) : (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
    ),
  pre: ({ children }) => <pre className="my-2">{children}</pre>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-brand/60 pl-3 text-muted-foreground">{children}</blockquote>,
  hr: () => <hr className="my-3 border-border" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/70 text-left">{children}</thead>,
  tbody: ({ children }) => <tbody className="[&>tr:nth-child(even)]:bg-muted/30">{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-border last:border-b-0">{children}</tr>,
  th: ({ children }) => <th className="px-3 py-1.5 font-medium text-foreground">{children}</th>,
  td: ({ children }) => <td className="px-3 py-1.5 align-top">{children}</td>,
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("text-sm text-foreground [&_table_strong]:font-medium", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
