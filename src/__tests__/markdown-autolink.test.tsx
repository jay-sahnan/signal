import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Markdown } from "@/components/ui/markdown";

/**
 * autoLinkDomains rewrites the raw markdown BEFORE parsing, so it must leave
 * fenced code blocks byte-for-byte alone: a bare domain on a code line used
 * to render as literal "[acme.com](https://acme.com)" inside a command the
 * user might copy.
 */
describe("Markdown domain auto-linking", () => {
  it("links a bare domain in prose", () => {
    render(<Markdown>visit acme.com today</Markdown>);

    const link = screen.getByRole("link", { name: "acme.com" });
    expect(link).toHaveAttribute("href", "https://acme.com");
  });

  it("leaves code blocks untouched", () => {
    const { container } = render(
      <Markdown>{"```\nping acme.com\n```"}</Markdown>,
    );

    expect(container.textContent).toContain("ping acme.com");
    expect(container.textContent).not.toContain("[acme.com]");
    expect(container.querySelector("code a")).toBeNull();
  });
});

/**
 * The agent used to say "head to /outreach/review?sequence=..." as bare prose
 * the user had to copy into the address bar, and every markdown link opened a
 * NEW tab, leaving the chat behind. In-app paths are now links that navigate
 * the current tab; external URLs still open a new tab.
 */
describe("Markdown in-app paths", () => {
  it("links a bare app path in prose, same tab", () => {
    render(
      <Markdown>
        {"Approve them at /outreach/review?sequence=abc-123 when ready."}
      </Markdown>,
    );
    const link = screen.getByRole("link", {
      name: "/outreach/review?sequence=abc-123",
    });
    expect(link).toHaveAttribute("href", "/outreach/review?sequence=abc-123");
    expect(link).not.toHaveAttribute("target");
  });

  it("does not link slashes that are not app routes", () => {
    const { container } = render(
      <Markdown>{"saved to /tmp/out.csv, ratio 3/4"}</Markdown>,
    );
    expect(container.querySelector("a")).toBeNull();
  });

  it("keeps external markdown links in a new tab", () => {
    render(<Markdown>{"[docs](https://example.com/docs)"}</Markdown>);
    expect(screen.getByRole("link", { name: "docs" })).toHaveAttribute(
      "target",
      "_blank",
    );
  });
});
