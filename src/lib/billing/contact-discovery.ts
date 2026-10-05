import { isHostedMode } from "@/lib/auth/workspace";
import { executePaidAction } from "./paid-action";
import { NoBillableWork, CompletedWithoutCharge } from "./credit-execution";
import type { Identity } from "@/lib/auth/identity";
import type { ContactDiscoveryResult } from "@/lib/services/contact-discovery";
type DiscoveryCharge = { identity: Identity; key: string | null; request: unknown };
/** Entry points must authorize company/campaign before calling. The work
 * callback is trusted server discovery, never client-supplied result data. */
export async function paidContactDiscovery<T extends ContactDiscoveryResult>(input: DiscoveryCharge, work: () => Promise<T>) {
  if (!isHostedMode()) return work();
  return executePaidAction<T>({ ...input, kind: "contact.discover" }, async () => {
    const result = await work();
    if (result.noBillableWork) return new NoBillableWork({ ...result,
      error: `${result.error ?? "Discovery could not start."} No credits were charged. After fixing the issue, start a new discovery request.`,
    });
    if (result.contacts.length === 0 && result.sourcesSucceeded === 0) {
      return new CompletedWithoutCharge({ ...result,
        error: "All contact discovery sources failed. No credits were charged. Start a new request to try again.",
      });
    }
    if (result.error) throw new Error("Contact discovery failed; contact support if pending");
    return result;
  });
}
