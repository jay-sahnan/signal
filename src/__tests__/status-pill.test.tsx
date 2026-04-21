import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusPill } from "@/components/ui/status-pill";

describe("<StatusPill>", () => {
  it("renders the status label", () => {
    render(<StatusPill status="needs_review" />);
    expect(screen.getByText("Needs review")).toBeInTheDocument();
  });

  it("supports a count override", () => {
    render(<StatusPill status="ready">12</StatusPill>);
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("applies tone class for the status", () => {
    const { container } = render(<StatusPill status="ready" />);
    expect(container.firstChild).toHaveClass("bg-primary/10");
  });
});
