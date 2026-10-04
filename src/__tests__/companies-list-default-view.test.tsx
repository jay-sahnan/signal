vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ userId: "owner" }) }));
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CampaignCompany, CampaignContact } from "@/lib/types/campaign";

// The org chart mounts a canvas-based renderer jsdom cannot drive, and this
// test only cares about which of the two views the component picks.
vi.mock("@/components/company/embedded-org-chart", () => ({
  EmbeddedOrgChart: () => <div data-testid="org-chart" />,
}));

vi.mock("@/lib/campaign-context", () => ({
  useCampaign: () => ({ openAgentWith: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

import { CompaniesList } from "@/components/campaign/companies-list";

const company: CampaignCompany = {
  id: "co1",
  organization_id: "o1",
  campaign_id: "c1",
  name: "Acme Robotics",
  domain: "acme.test",
  url: "https://acme.test",
  industry: "Robotics",
  location: "SF",
  description: null,
  relevance_score: 8,
  score_reason: null,
  status: "qualified",
  readiness_tag: null,
  enrichment_data: {},
  source: "exa",
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

const contact = {
  id: "ct1",
  person_id: "p1",
  campaign_id: "c1",
  organization_id: "o1",
  name: "Dana Whitfield",
  title: "VP Engineering",
  work_email: "dana@acme.test",
  work_email_source: "pattern_derived",
  work_email_verification: "unchecked",
  enrichment_status: "enriched",
  enrichment_data: {},
  outreach_status: "not_contacted",
} as unknown as CampaignContact;

function renderExpanded(overrides?: Partial<CampaignCompany>) {
  const target = { ...company, ...overrides };
  // Contacts are grouped by organization_id, so the fixture contact has to
  // follow the company for the expanded row to have anything in it.
  render(
    <CompaniesList
      campaignId="c1"
      companies={[target]}
      contacts={[{ ...contact, organization_id: target.organization_id }]}
      onContactEnriched={vi.fn()}
      onCompanyEnriched={vi.fn()}
      onDataChanged={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByText("Acme Robotics"));
}

const pill = (name: "List" | "Org chart") =>
  screen.getByRole("button", { name });

// vitest runs without `globals`, so Testing Library's automatic teardown never
// registers and renders would otherwise stack up across tests.
afterEach(cleanup);

describe("<CompaniesList> expanded company view", () => {
  it("shows the contact list, not the org chart, by default", () => {
    renderExpanded();

    expect(screen.queryByTestId("org-chart")).not.toBeInTheDocument();
    expect(screen.getByText("Dana Whitfield")).toBeInTheDocument();
  });

  it("marks List as the active pill by default", () => {
    renderExpanded();

    expect(pill("List")).toHaveAttribute("aria-pressed", "true");
    expect(pill("Org chart")).toHaveAttribute("aria-pressed", "false");
  });

  it("switches to the org chart only when asked, and back again", () => {
    renderExpanded();

    fireEvent.click(pill("Org chart"));
    expect(screen.getByTestId("org-chart")).toBeInTheDocument();
    expect(pill("Org chart")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(pill("List"));
    expect(screen.queryByTestId("org-chart")).not.toBeInTheDocument();
    expect(screen.getByText("Dana Whitfield")).toBeInTheDocument();
  });

  it("stays on the list when the company has no organization id", () => {
    renderExpanded({ organization_id: null as never });

    fireEvent.click(pill("Org chart"));

    expect(screen.queryByTestId("org-chart")).not.toBeInTheDocument();
    expect(pill("List")).toHaveAttribute("aria-pressed", "true");
  });
});
