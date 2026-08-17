import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";
import { isNavigablePath } from "@/lib/navigation";

interface MarkdownProps {
  children: string;
  className?: string;
}

const DOMAIN_RE =
  /(?<=^|[\s|])([a-z0-9][-a-z0-9]*(?:\.[a-z0-9][-a-z0-9]*)*\.(?:co\.uk|com|org|net|io|dev|ai|uk|app|xyz|biz|me|co|tech|agency|info|us|ca|de|fr|eu|property|estate|house|homes|realty))(?=[\s|,)]|$)/gim;

/**
 * Bare in-app paths in prose ("approve them at /outreach/review?sequence=...")
 * become links. Only paths the app actually serves (isNavigablePath), so a
 * stray "/tmp/x" or a slash inside a sentence is left alone. Fenced code is
 * skipped by the same segment split as autoLinkDomains.
 */
const APP_PATH_RE =
  /(?<=^|[\s(])(\/[a-z][a-z0-9\-\/]*(?:\?[^\s)<>"']*)?)(?=[\s.,;:)]|$)/gim;

function autoLinkAppPaths(text: string): string {
  return text.replace(APP_PATH_RE, (match) => {
    // A trailing "." or "," is sentence punctuation, not the path.
    const trimmed = match.replace(/[.,;:]+$/, "");
    if (!isNavigablePath(trimmed) || trimmed === "/") return match;
    return `[${trimmed}](${trimmed})${match.slice(trimmed.length)}`;
  });
}

function autoLinkDomains(text: string): string {
  // Fenced code blocks are left byte-for-byte alone: this rewrite runs on the
  // raw markdown BEFORE parsing, so a bare domain on a line inside ``` used
  // to render as literal "[acme.com](https://acme.com)" in the middle of a
  // command the user might copy.
  const segments = text.split(/(```[\s\S]*?(?:```|$))/);
  return segments
    .map((segment, i) =>
      i % 2 === 1
        ? segment
        : autoLinkAppPaths(
            segment.replace(DOMAIN_RE, (match) =>
              match.includes(":") ? match : `[${match}](https://${match})`,
            ),
          ),
    )
    .join("");
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
          // In-app paths navigate the tab the user is in, chat panel and
          // all; only real external URLs open a new tab.
          a: ({ children, href, ...props }) =>
            href && isNavigablePath(href) ? (
              <Link href={href} {...props}>
                {children}
              </Link>
            ) : (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                {...props}
              >
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
