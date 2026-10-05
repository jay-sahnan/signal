vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ userId: "owner" }) }));
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The find-leads path on the campaign page, from the button that was missing to
 * the answer that was thrown away.
 *
 * Two failures met here. `/api/find-contacts` reports a refusal as HTTP 200
 * with an `error` field (a company with no domain on record cannot hold
 * contacts, and that is the normal outcome for directory-sourced companies),
 * and `findContactsHandler` never read the response at all: no toast on
 * success, none on refusal, and a `catch` that could not fire because apiFetch
 * does not throw on a non-2xx. The user clicked, watched a spinner, and got
 * nothing.
 *
 * And the button only existed inside an expanded company in the "with leads"
 * section, behind `companyContacts.length === 0`, which that section cannot
 * reach. So a company with no leads, the only kind you would want to search,
 * had no way to search at all. That is why these tests drive it through the
 * "Companies without leads" group: it is the only place the button can render.
 */

vi.mock("@/components/company/embedded-org-chart", () => ({
  EmbeddedOrgChart: () => null,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({ update: () => ({ eq: () => ({}) }) }),
  }),
}));

vi.mock("@/lib/api-fetch", () => ({ apiFetch: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { toast } from "sonner";
import { apiFetch } from "@/lib/api-fetch";
import { CompaniesList } from "@/components/campaign/companies-list";
import type { CampaignCompany } from "@/lib/types/campaign";

const CAMPAIGN = "22222222-2222-2222-2222-222222222222";

function company(partial: Partial<CampaignCompany> = {}): CampaignCompany {
  return {
    id: "cc1",
    organization_id: "11111111-1111-1111-1111-111111111111",
    campaign_id: CAMPAIGN,
    name: "Cedar Lodge Nursing Home",
    domain: "cedarlodge.co.uk",
    url: null,
    industry: "Nursing Home",
    location: "Birmingham",
    description: null,
    relevance_score: null,
    score_reason: null,
    status: "discovered",
    readiness_tag: null,
    enrichment_data: { enrichedAt: "2026-08-01T00:00:00Z" },
    source: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...partial,
  };
}

const onDataChanged = vi.fn();

/** Render with no contacts at all, which is the reported campaign's state. */
function renderWithoutLeads(companies: CampaignCompany[] = [company()]) {
  render(
    <CompaniesList
      campaignId={CAMPAIGN}
      companies={companies}
      contacts={[]}
      onContactEnriched={vi.fn()}
      onCompanyEnriched={vi.fn()}
      onDataChanged={onDataChanged}
    />,
  );
  fireEvent.click(screen.getByLabelText("Expand companies without leads"));
}

/** What apiFetch resolves with. Never throws, exactly like the real one. */
function respondWith(body: unknown, ok = true) {
  vi.mocked(apiFetch).mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response);
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  onDataChanged.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.info).mockReset();
});

afterEach(cleanup);

describe("<CompaniesList> find leads", () => {
  it("offers a find-leads button on a company with no leads", async () => {
    respondWith({ contacts: [], totalFound: 0 });
    renderWithoutLeads();

    fireEvent.click(
      screen.getByLabelText("Find leads for Cedar Lodge Nursing Home"),
    );

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [url, init] = vi.mocked(apiFetch).mock.calls[0];
    expect(url).toBe("/api/find-contacts");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      companyId: "cc1",
      campaignId: CAMPAIGN,
    });
  });

  it("surfaces a refusal that came back as a 200", async () => {
    const refusal =
      '"Cedar Lodge Nursing Home" has no domain on record, so contacts cannot be attached to it.';
    respondWith({ contacts: [], totalFound: 0, error: refusal });
    renderWithoutLeads();

    fireEvent.click(
      screen.getByLabelText("Find leads for Cedar Lodge Nursing Home"),
    );

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(refusal));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("says so when the search found nobody new", async () => {
    respondWith({ contacts: [], totalFound: 0 });
    renderWithoutLeads();

    fireEvent.click(
      screen.getByLabelText("Find leads for Cedar Lodge Nursing Home"),
    );

    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(vi.mocked(toast.info).mock.calls[0][0]).toMatch(/no new/i);
    // The run may still have written rows (duplicates skipped, affiliations
    // touched), so the page refetches either way.
    expect(onDataChanged).toHaveBeenCalled();
  });

  it("reports the count and the unconfirmed remainder on success", async () => {
    respondWith({
      contacts: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
      totalFound: 3,
      verifiedCount: 1,
      uncertainCount: 2,
      rejectedAsWrongCompany: 1,
    });
    renderWithoutLeads();

    fireEvent.click(
      screen.getByLabelText("Find leads for Cedar Lodge Nursing Home"),
    );

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const message = vi.mocked(toast.success).mock.calls[0][0] as string;
    expect(message).toContain("3");
    // Unconfirmed contacts are blocked from outreach, so a bare "found 3" is a
    // count the user cannot act on.
    expect(message).toMatch(/2 unconfirmed/);
    expect(message).toMatch(/1 work elsewhere/);
    expect(onDataChanged).toHaveBeenCalled();
  });

  it("reports a failed request as a failure", async () => {
    respondWith({ error: "Forbidden" }, false);
    renderWithoutLeads();

    fireEvent.click(
      screen.getByLabelText("Find leads for Cedar Lodge Nursing Home"),
    );

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("does not offer the search on a company with no website on record", () => {
    renderWithoutLeads([company({ domain: null })]);

    // Discovery refuses a domain-less company before it searches, so an
    // enabled button here is a guaranteed round trip to a toast. Say why
    // instead.
    expect(
      screen.queryByLabelText("Find leads for Cedar Lodge Nursing Home"),
    ).toBeNull();
    expect(screen.getByText(/no website on record/i)).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

/**
 * The way out of the dead end. A domain-less company cannot hold contacts, and
 * before this there was no way at all to give one a website: the field is
 * written on INSERT and never again.
 */
describe("<CompaniesList> missing website", () => {
  it("looks the website up on request", async () => {
    respondWith({ merged: false, domain: "cedarlodge.co.uk" });
    renderWithoutLeads([company({ domain: null })]);

    fireEvent.click(
      screen.getByLabelText("Find website for Cedar Lodge Nursing Home"),
    );

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [url, init] = vi.mocked(apiFetch).mock.calls[0];
    // The organization id, not the campaign link id: this writes to the shared
    // company row.
    expect(url).toBe(
      "/api/companies/11111111-1111-1111-1111-111111111111/website",
    );
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      resolve: true,
    });
    await waitFor(() => expect(onDataChanged).toHaveBeenCalled());
  });

  it("saves an address the user types", async () => {
    respondWith({ merged: false, domain: "cedarlodge.co.uk" });
    renderWithoutLeads([company({ domain: null })]);

    const input = screen.getByLabelText("Website for Cedar Lodge Nursing Home");
    fireEvent.change(input, { target: { value: "cedarlodge.co.uk" } });
    fireEvent.click(
      screen.getByLabelText("Save website for Cedar Lodge Nursing Home"),
    );

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [, init] = vi.mocked(apiFetch).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      url: "cedarlodge.co.uk",
    });
  });

  it("says so when no website could be found", async () => {
    respondWith({
      error: 'Could not find a website for "Cedar Lodge Nursing Home".',
    });
    renderWithoutLeads([company({ domain: null })]);

    fireEvent.click(
      screen.getByLabelText("Find website for Cedar Lodge Nursing Home"),
    );

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("reports a merge, since the row the user was looking at is gone", async () => {
    respondWith({
      merged: true,
      into: "org-twin",
      domain: "cedarlodge.co.uk",
      message: "Merged into the existing record for cedarlodge.co.uk.",
    });
    renderWithoutLeads([company({ domain: null })]);

    fireEvent.click(
      screen.getByLabelText("Find website for Cedar Lodge Nursing Home"),
    );

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(vi.mocked(toast.success).mock.calls[0][0]).toMatch(/merged/i);
    expect(onDataChanged).toHaveBeenCalled();
  });
});
