import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { RelativeTime } from "@/components/ui/relative-time";

const NOW = new Date("2026-04-19T12:00:00Z");

describe("<RelativeTime>", () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(NOW));
  afterEach(() => vi.useRealTimers());

  it("renders 'in 3h' for a future time", () => {
    const future = new Date(NOW.getTime() + 3 * 60 * 60 * 1000).toISOString();
    render(<RelativeTime iso={future} />);
    expect(screen.getByText("in 3h")).toBeInTheDocument();
  });

  it("renders '3h ago' for a past time", () => {
    const past = new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString();
    render(<RelativeTime iso={past} />);
    expect(screen.getByText("3h ago")).toBeInTheDocument();
  });

  it("renders 'now' for delta under a minute", () => {
    render(<RelativeTime iso={NOW.toISOString()} />);
    expect(screen.getByText("now")).toBeInTheDocument();
  });
});
