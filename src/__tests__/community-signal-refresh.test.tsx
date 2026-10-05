import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ copied: false, existing: false, rpc: vi.fn(), queries: 0 }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("campaign=campaign") }));
vi.mock("@/lib/campaign-context", () => ({ useCampaign: () => ({ openAgentWith: vi.fn(), agentOpen: false }) }));
vi.mock("@/components/signals/signal-detail-dialog", () => ({ SignalDetailDialog: () => null }));
vi.mock("@/components/signals/signal-card", () => ({ SignalCard: ({ signal, enabled, onToggle }: { signal: { id: string }; enabled: boolean; onToggle: (id: string, enabled: boolean) => void }) => <button aria-label={signal.id} aria-pressed={enabled} onClick={() => onToggle(signal.id, !enabled)}>{signal.id}</button> }));
vi.mock("@/components/ui/select", () => ({ Select: () => null }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: h.rpc, from: (table: string) => {
  const query = { select: () => query, order: () => query, eq: () => query, then: (resolve: (value: unknown) => void) => {
    if (table === "campaign_signals") h.queries++;
    const data = table === "signals" ? [
      { id: "existing", is_builtin: true }, { id: "source", is_public: true, is_builtin: false },
      ...(h.copied ? [{ id: "copy", is_public: false, is_builtin: false, source_signal_id: "source" }] : []),
    ] : table === "campaigns" ? [{ id: "campaign", name: "Campaign" }] : table === "campaign_signals" ? [
      { signal_id: "existing", enabled: h.existing }, ...(h.copied ? [{ signal_id: "copy", enabled: true }] : []),
    ] : [];
    resolve({ data, error: null });
  } }; return query;
} }) }));
import SignalsPage from "@/app/signals/page";
afterEach(cleanup);
it("preserves a pending existing toggle when community activation refreshes the gallery", async () => {
  h.copied = false; h.existing = false; h.queries = 0;
  let finishExisting!: () => void;
  h.rpc.mockImplementation(async (_name, input) => {
    if (input.p_signal === "existing") await new Promise<void>(resolve => { finishExisting = () => { h.existing = true; resolve(); }; });
    else h.copied = true;
    return { data: { signal_id: input.p_signal === "source" ? "copy" : "existing", enabled: true }, error: null };
  });
  render(<SignalsPage />);
  await screen.findByLabelText("existing");
  await waitFor(() => expect(h.queries).toBe(1));
  fireEvent.click(screen.getByLabelText("existing"));
  fireEvent.click(screen.getByLabelText("source"));
  await screen.findByLabelText("copy");
  await act(async () => { finishExisting(); });
  expect(screen.getByLabelText("existing").getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByLabelText("copy").getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByText("Community"));
  expect(screen.getByLabelText("copy")).toBeTruthy();
});
