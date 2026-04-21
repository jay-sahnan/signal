import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

interface MarkdownProps {
  children: string;
  className?: string;
}

const DOMAIN_RE =
  /(?<=^|[\s|])([a-z0-9][-a-z0-9]*(?:\.[a-z0-9][-a-z0-9]*)*\.(?:co\.uk|com|org|net|io|dev|ai|uk|app|xyz|biz|me|co|tech|agency|info|us|ca|de|fr|eu|property|estate|house|homes|realty))(?=[\s|,)]|$)/gim;

function autoLinkDomains(text: string): string {
  return text.replace(DOMAIN_RE, (match) =>
    match.includes(":") ? match : `[${match}](https://${match})`,
  );
}

export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none break-words",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href, ...props }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
              {children}
            </a>
          ),
          p: ({ children, ...props }) => (
            <p className="mb-2 last:mb-0" {...props}>
              {children}
            </p>
          ),
        }}
      >
        {autoLinkDomains(children)}
      </ReactMarkdown>
    </div>
  );
}
