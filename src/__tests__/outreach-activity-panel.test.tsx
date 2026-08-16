import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActivityItem } from "@/lib/outreach/activity";

// The detail pane fetches on expand; this file is about the list.
vi.mock("@/components/outreach/activity-detail", () => ({
  ActivityDetail: ({ id }: { id: string }) => (
    <div data-testid="detail">{id}</div>
  ),
}));

import { OutreachActivityPanel } from "@/components/outreach/outreach-activity-panel";

// vitest runs without `globals`, so Testing Library's automatic teardown never
// registers and renders would stack up across tests.
afterEach(cleanup);

function item(over: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: "se_1",
    source: "sent",
    state: "replied",
    campaign_id: null,
    campaign_name: null,
    person_name: "Dana Whitfield",
    person_title: "VP Engineering",
    company_name: "Fernpath",
    to_email: "dana@fernpath.test",
    subject: "Metering to invoice",
    at: "2026-08-03T10:00:00Z",
    sent_at: "2026-08-02T09:00:00Z",
    next_send_at: null,
    reply_count: 1,
    reply_snippet: "How does it handle proration?",
    reply_captured: true,
    error: null,
    gmail_url: "https://mail.google.com/mail/u/#search/x",
    ...over,
  };
}

function renderPanel(items: ActivityItem[], filter = "all") {
  const onFilterChange = vi.fn();
  render(
    <OutreachActivityPanel
      items={items}
      filter={filter as "all"}
      onFilterChange={onFilterChange}
    />,
  );
  return { onFilterChange };
}

describe("<OutreachActivityPanel>", () => {
  it("shows the reply without needing to expand or filter", () => {
    // Replies being findable at a glance is the entire point of this surface.
    renderPanel([item()]);

    expect(screen.getByText("Dana Whitfield")).toBeInTheDocument();
    expect(screen.getByText("Fernpath")).toBeInTheDocument();
    expect(
      screen.getByText("How does it handle proration?"),
    ).toBeInTheDocument();
  });

  it("says so when a reply arrived but its words were not captured", () => {
    // Distinct from an empty reply. Rendering nothing here would read as "they
    // replied with silence", and this is the permanent state for anything that
    // replied before capture existed.
    renderPanel([item({ reply_snippet: null, reply_captured: false })]);

    expect(
      screen.getByText("Replied, content not captured"),
    ).toBeInTheDocument();
  });

  it("surfaces a blocked reason on the collapsed row", () => {
    renderPanel([
      item({
        id: "draft:1",
        source: "pending",
        state: "blocked",
        reply_snippet: null,
        reply_count: 0,
        error: {
          kind: "blocked",
          message: "Not sending to dana@fernpath.test: address is unverified.",
          at: "2026-08-03T10:00:00Z",
        },
      }),
    ]);

    expect(screen.getByText(/address is unverified/)).toBeInTheDocument();
  });

  it("keeps a deferred draft quiet", () => {
    // Hitting the daily cap resolves itself tomorrow. Shouting about it on the
    // row would train the user to ignore the rows that do need them.
    renderPanel([
      item({
        id: "draft:2",
        source: "pending",
        state: "deferred",
        reply_snippet: null,
        error: {
          kind: "deferred",
          message: "Daily send limit reached (5/day), draft left for tomorrow",
          at: "2026-08-03T10:00:00Z",
        },
      }),
    ]);

    expect(screen.getByText("Deferred")).toBeInTheDocument();
    expect(screen.queryByText(/Daily send limit/)).not.toBeInTheDocument();
  });

  it("narrows to the selected filter", () => {
    const items = [
      item({ id: "a", state: "replied" }),
      item({ id: "b", state: "sent", reply_snippet: null, reply_count: 0 }),
      item({
        id: "draft:c",
        source: "pending",
        state: "blocked",
        reply_snippet: null,
        reply_count: 0,
      }),
    ];

    renderPanel(items, "failed");

    // "Needs attention" covers blocked as well as failed: both wait on a human.
    // The replied and sent rows must not leak through.
    expect(document.querySelectorAll("tbody tr[role=button]")).toHaveLength(1);
    // Scoped to the table: "Replied" and "Sent" are also filter chip labels.
    const table = within(document.querySelector("tbody") as HTMLElement);
    expect(table.getByText("Blocked")).toBeInTheDocument();
    expect(table.queryByText("Replied")).not.toBeInTheDocument();
    expect(table.queryByText("Sent")).not.toBeInTheDocument();
  });

  it("expands a row to its detail, and collapses it again", () => {
    renderPanel([item()]);
    const row = document.querySelector("tbody tr[role=button]")!;

    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("detail")).not.toBeInTheDocument();

    fireEvent.click(row);
    expect(screen.getByTestId("detail")).toHaveTextContent("se_1");
    expect(
      document
        .querySelector("tbody tr[role=button]")!
        .getAttribute("aria-expanded"),
    ).toBe("true");

    fireEvent.click(document.querySelector("tbody tr[role=button]")!);
    expect(screen.queryByTestId("detail")).not.toBeInTheDocument();
  });

  it("opens on Enter as well as click", () => {
    // Rows are divs-as-buttons, so keyboard parity is not free.
    renderPanel([item()]);
    const row = document.querySelector("tbody tr[role=button]")!;

    fireEvent.keyDown(row, { key: "Enter" });
    expect(screen.getByTestId("detail")).toBeInTheDocument();
  });

  it("offers an empty state rather than a bare table", () => {
    renderPanel([]);
    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
  });
});
