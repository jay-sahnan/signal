import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The panel writes through supabase and apiFetch on user actions; this file
// only renders the list, so both are stubbed out.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: vi.fn(),
}));

import {
  classifyDraft,
  OutreachDraftsPanel,
  type DraftRow,
} from "@/components/outreach/outreach-drafts-panel";

// vitest runs without `globals`, so Testing Library's automatic teardown never
// registers and renders would stack up across tests.
afterEach(cleanup);

function draft(over: Partial<DraftRow> = {}): DraftRow {
  return {
    id: "d_1",
    subject: "AI in the post-sales stack",
    to_email: "mark@trig.test",
    review_status: "pending",
    status: "draft",
    person_name: "Mark Ryan",
    person_title: "Head of Marketing",
    company_name: "Trig",
    sequence_id: null,
    sequence_name: null,
    campaign_id: null,
    campaign_name: null,
    next_send_at: null,
    step_number: 1,
    total_steps: 1,
    enrollment_id: null,
    has_inbox: true,
    ...over,
  };
}

describe("classifyDraft ad-hoc drafts", () => {
  it("files an approved ad-hoc draft as ready, not blocked", () => {
    // Regression: approved drafts without an enrollment were classified
    // "blocked" with a bare "No enrollment" label and no action anywhere;
    // send-now now handles them directly, so they are sendable.
    expect(
      classifyDraft(draft({ review_status: "approved", enrollment_id: null })),
    ).toBe("ready");
  });

  it("still blocks an approved draft when no inbox is configured", () => {
    expect(
      classifyDraft(
        draft({
          review_status: "approved",
          enrollment_id: null,
          has_inbox: false,
        }),
      ),
    ).toBe("blocked");
  });
});

describe("<OutreachDraftsPanel> review buttons", () => {
  it("links sequence drafts to their sequence review queue", () => {
    render(
      <OutreachDraftsPanel
        drafts={[draft({ sequence_id: "seq-1", enrollment_id: "en-1" })]}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute(
      "href",
      "/outreach/review?sequence=seq-1",
    );
  });

  it("links ad-hoc drafts (no sequence) to the ad-hoc review queue", () => {
    // Regression: the button used to render only when the group had a
    // sequence_id, so agent-written one-off drafts sat in "Needs review"
    // with nothing to click and no way to ever approve them.
    render(<OutreachDraftsPanel drafts={[draft()]} onRefresh={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute(
      "href",
      "/outreach/review",
    );
  });
});
