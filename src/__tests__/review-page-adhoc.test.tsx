vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ userId: "owner" }) }));
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ── Router: which mode the page runs in comes from the URL ────────────────
let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: vi.fn() }));
// Enrichment sidebar pulls in a deep component tree; the queue logic under
// test never touches it.
vi.mock("@/components/campaign/contact-detail", () => ({
  ContactDetail: () => <div data-testid="contact-detail" />,
}));

// ── Supabase: one chainable, awaitable query builder per .from() call ─────
interface BuilderCall {
  table: string;
  filters: Array<[string, string, unknown]>;
  updatePayload?: Record<string, unknown>;
}
let builderCalls: BuilderCall[] = [];
let draftRows: unknown[] = [];

function makeBuilder(table: string) {
  const call: BuilderCall = { table, filters: [] };
  builderCalls.push(call);
  const builder = {
    select: () => builder,
    order: () => builder,
    in: () => builder,
    update: (payload: Record<string, unknown>) => {
      call.updatePayload = payload;
      return builder;
    },
    eq: (col: string, val: unknown) => {
      call.filters.push([table, col, val]);
      return builder;
    },
    is: (col: string, val: unknown) => {
      call.filters.push([table, col, val]);
      return builder;
    },
    then: (resolve: (v: { data: unknown[]; error: null }) => void) => {
      // Reads return the seeded drafts; the review_status write echoes ids
      // back (the page verifies the updated row count); other writes are {}.
      const rows =
        table === "email_drafts" && !call.updatePayload
          ? draftRows
          : call.updatePayload && "review_status" in call.updatePayload
            ? draftRows.map((d) => ({ id: (d as { id: string }).id }))
            : [];
      return Promise.resolve({ data: rows, error: null }).then(resolve);
    },
  };
  return builder;
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from: (table: string) => makeBuilder(table) }),
}));

import ReviewPage from "@/app/outreach/review/page";

afterEach(() => {
  cleanup();
  builderCalls = [];
  draftRows = [];
});

function adhocDraft(id: string, personId: string, name: string) {
  return {
    id,
    to_email: `${personId}@example.test`,
    subject: `Subject for ${name}`,
    body_html: "<p>Hi</p>",
    body_text: "Hi",
    ai_reasoning: null,
    review_status: "pending",
    status: "draft",
    sequence_step_id: null,
    enrollment_id: null,
    person_id: personId,
    people: {
      name,
      title: null,
      bio_summary: null,
      organization_id: null,
      enrichment_data: {},
      enrichment_status: "pending",
      last_enriched_at: null,
      work_email: null,
      work_email_confidence: null,
      work_email_source: null,
      work_email_verification: null,
      affiliation_source: null,
      affiliation_confidence: null,
      affiliation_evidence: null,
      personal_email: null,
      linkedin_url: null,
      twitter_url: null,
      organizations: null,
    },
    campaign_people: null,
    sequence_enrollments: null,
    sequence_steps: null,
  };
}

describe("review page ad-hoc mode", () => {
  it("without a sequence param, loads pending drafts with a null sequence", async () => {
    // Regression: this used to dead-end at "No sequence specified.", which
    // made agent-written one-off drafts unreviewable anywhere in the app.
    search = "";
    draftRows = [adhocDraft("d1", "p1", "Mark Ryan")];

    render(<ReviewPage />);

    // Main pane h2 and sidebar h3 both carry the contact's name.
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Mark Ryan", level: 2 }),
      ).toBeVisible(),
    );

    const draftsCall = builderCalls.find((c) => c.table === "email_drafts");
    expect(draftsCall?.filters).toContainEqual([
      "email_drafts",
      "sequence_id",
      null,
    ]);
    // No sequence, no steps to count.
    expect(builderCalls.some((c) => c.table === "sequence_steps")).toBe(false);

    // A one-off draft is not "Step 1 of 1" of anything.
    expect(screen.getByText("One-off email")).toBeVisible();
    expect(screen.queryByText(/Step 1 of/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve all" })).toBeEnabled();
  });

  it("a subject-only edit never rewrites the body", async () => {
    // Regression: the save payload used to include body_html/body_text
    // unconditionally, so tweaking just the subject pushed the untouched
    // body through the lossy htmlToPlain -> plainToHtml round-trip and
    // silently stripped every link the composer had written.
    search = "";
    draftRows = [adhocDraft("d1", "p1", "Mark Ryan")];

    render(<ReviewPage />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Mark Ryan", level: 2 }),
      ).toBeVisible(),
    );

    fireEvent.change(screen.getByPlaceholderText("Subject..."), {
      target: { value: "A sharper subject" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve all" }));

    await waitFor(() => {
      const editWrite = builderCalls.find(
        (c) =>
          c.table === "email_drafts" &&
          c.updatePayload &&
          "subject" in c.updatePayload,
      );
      expect(editWrite).toBeDefined();
      expect(editWrite!.updatePayload).not.toHaveProperty("body_html");
      expect(editWrite!.updatePayload).not.toHaveProperty("body_text");
    });
  });

  it("with a sequence param, still scopes to that sequence", async () => {
    search = "sequence=seq-1";
    draftRows = [];

    render(<ReviewPage />);

    await waitFor(() =>
      expect(screen.getByText("No drafts to review.")).toBeVisible(),
    );

    const draftsCall = builderCalls.find((c) => c.table === "email_drafts");
    expect(draftsCall?.filters).toContainEqual([
      "email_drafts",
      "sequence_id",
      "seq-1",
    ]);
    expect(builderCalls.some((c) => c.table === "sequence_steps")).toBe(true);
  });
});
