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
 * "Enrich all" spends money per contact, so the two things worth protecting
 * are that it asks first and that a failure is not reported as a success.
 */

vi.mock("@/lib/api-fetch", () => ({ apiFetch: vi.fn() }));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (m: string) => toastSuccess(m),
    error: (m: string) => toastError(m),
  },
}));

import { apiFetch } from "@/lib/api-fetch";
import { EnrichAllButton } from "@/components/company/enrich-all-button";

const fetchMock = vi.mocked(apiFetch);

afterEach(cleanup);
beforeEach(() => {
  sessionStorage.clear();
  fetchMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

function renderButton(count = 3) {
  const onDone = vi.fn();
  render(
    <EnrichAllButton
      campaignId="camp_1"
      organizationId="org_1"
      unenrichedCount={count}
      personIds={Array.from({ length: count }, (_, i) => `person-${i}`)}
      onDone={onDone}
    />,
  );
  return { onDone };
}

const ok = (body: unknown) =>
  ({ ok: true, json: async () => body }) as unknown as Response;

describe("<EnrichAllButton>", () => {
  it("does not spend anything until the confirm is accepted", () => {
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /Enrich all/ }));

    // Dialog open, nothing requested yet.
    expect(screen.getByText("Enrich 3 contacts?")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancelling spends nothing", () => {
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /Enrich all/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs on confirm and reports the route's own summary", async () => {
    // The route knows about the batch cap and the skip; its sentence is the
    // accurate one, so the button must not paraphrase it.
    fetchMock.mockResolvedValue(
      ok({
        enriched: 3,
        summary: "Enriched 3 of 3. 2 already enriched, skipped.",
      }),
    );
    const { onDone } = renderButton();

    fireEvent.click(screen.getByRole("button", { name: /Enrich all/ }));
    fireEvent.click(screen.getByRole("button", { name: "Enrich 3" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/enrich/bulk",
      expect.objectContaining({ method: "POST" }),
    );
    expect(toastSuccess).toHaveBeenCalledWith(
      "Enriched 3 of 3. 2 already enriched, skipped.",
    );
  });

  it("treats a non-2xx as a failure, not a run that enriched nobody", async () => {
    // apiFetch returns the Response unchanged and never throws, so without an
    // explicit ok check an error body reads as a successful empty run.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "Forbidden" }),
    } as unknown as Response);
    const { onDone } = renderButton();

    fireEvent.click(screen.getByRole("button", { name: /Enrich all/ }));
    fireEvent.click(screen.getByRole("button", { name: "Enrich 3" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Forbidden"));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("renders nothing when there is nobody left to enrich", () => {
    renderButton(0);
    expect(
      screen.queryByRole("button", { name: /Enrich all/ }),
    ).not.toBeInTheDocument();
  });

  it("uses the singular for one contact", () => {
    renderButton(1);
    fireEvent.click(screen.getByRole("button", { name: /Enrich all/ }));
    expect(screen.getByText("Enrich 1 contact?")).toBeInTheDocument();
  });
});
