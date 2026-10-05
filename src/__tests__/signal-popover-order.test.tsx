import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ copied: false, enabled: false, rpc: vi.fn(), release: null as null | (() => void), hold: false }));
vi.mock("@/components/safe-link", () => ({ SafeLink: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/ui/popover", () => ({ Popover: ({ children, onOpenChange }: { children: React.ReactNode; onOpenChange: (open: boolean) => void }) => <><button aria-label="open" onClick={() => onOpenChange(true)} />{children}</>, PopoverContent: ({ children }: { children: React.ReactNode }) => children, PopoverTrigger: () => null }));
vi.mock("@/components/ui/switch", () => ({ Switch: ({ checked, disabled, onCheckedChange }: { checked: boolean; disabled: boolean; onCheckedChange: (value: boolean) => void }) => <button role="switch" aria-checked={checked} disabled={disabled} onClick={() => onCheckedChange(!checked)} /> }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: h.rpc, from: (table: string) => {
  const query = { select: () => query, order: () => query, eq: () => query, then: async (resolve: (value: unknown) => void) => {
    const data = table === "signals" ? [{ id: "source", name: "Source", is_public: true }, ...(h.copied ? [{ id: "copy", name: "Copy", is_public: false, source_signal_id: "source" }] : [])]
      : h.copied ? [{ signal_id: "copy", enabled: h.enabled }] : [];
    if (table === "campaign_signals" && h.hold) await new Promise<void>(done => { h.release = done; });
    resolve({ data, error: null });
  } }; return query;
} }) }));
import { CampaignSignalsPopover } from "@/components/signals/campaign-signals-popover";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("keeps the copy refresh inside the toggle lock before allowing Off", async () => {
  h.copied = false; h.enabled = false; h.hold = false; h.release = null;
  h.rpc.mockImplementation(async (_name, input) => {
    h.copied = true; h.enabled = input.p_enabled;
    return { data: { signal_id: "copy", enabled: input.p_enabled }, error: null };
  });
  render(<CampaignSignalsPopover campaignId="campaign" />);
  const toggle = await screen.findByRole("switch");
  h.hold = true;
  fireEvent.click(toggle);
  await waitFor(() => expect(h.release).not.toBeNull());
  expect((toggle as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(toggle);
  expect(h.rpc).toHaveBeenCalledTimes(1);
  h.hold = false;
  await act(async () => { h.release!(); });
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  fireEvent.click(screen.getByRole("switch"));
  await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
});

it("ignores an initial read that finishes after opening and toggling", async () => {
  h.copied = false; h.enabled = false; h.hold = true; h.release = null;
  h.rpc.mockImplementation(async (_name, input) => {
    h.copied = true; h.enabled = input.p_enabled;
    return { data: { signal_id: "copy", enabled: input.p_enabled }, error: null };
  });
  render(<CampaignSignalsPopover campaignId="campaign" />);
  await waitFor(() => expect(h.release).not.toBeNull());
  const releaseInitial = h.release!;
  h.hold = false;
  fireEvent.click(screen.getByLabelText("open"));
  fireEvent.click(await screen.findByRole("switch"));
  await screen.findByText("Copy");
  await act(async () => { releaseInitial(); });
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  expect(screen.getByText("Copy")).toBeTruthy();
});
