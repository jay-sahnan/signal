import { tool } from "ai";
import { z } from "zod";

import { isNavigablePath, NAVIGABLE_PREFIXES } from "@/lib/navigation";

/**
 * openPage: the agent takes the user to a page in the app instead of telling
 * them to go there.
 *
 * "Head to /outreach/review to approve" was the whole hand-off before: a bare
 * path in prose, not even a link, that the user had to copy into the address
 * bar (leaving the chat behind). The tool writes a transient `data-navigate`
 * part that the agent panel turns into a client-side router.push, so the page
 * opens in the SAME tab with the chat still beside it. The tool result renders
 * as a button, so the destination stays one click away after the turn ends
 * and after a reload (transient parts are never persisted, so a rehydrated
 * chat never re-navigates on its own).
 *
 * Paths are validated against the app's own routes, and only paths: no
 * scheme, no host, no protocol-relative `//`, so this can never become an
 * open redirect driven by tool output.
 */

interface NavToolCtx {
  writer?: { write: (chunk: unknown) => void };
}

export const openPage = tool({
  description:
    "Open a page of this app for the user, in the tab they are already in, with " +
    "this chat still open beside it. Use it INSTEAD of telling the user to 'go to' " +
    "or 'head to' a path: after drafts land, open the review queue; after a " +
    "sequence is created, open it; when they need a setting, open Settings. The " +
    "result also renders as a button so they can come back to the page later. " +
    "Paths only (e.g. '/outreach/review?sequence=<id>'), never full URLs.",
  inputSchema: z.object({
    path: z
      .string()
      .min(1)
      .max(500)
      .describe(
        "In-app path, starting with '/'. Query strings are fine: '/outreach/review?sequence=<uuid>'.",
      ),
    label: z
      .string()
      .min(1)
      .max(60)
      .describe(
        "Short button label naming the destination, e.g. 'Review queue', 'Founder Outreach sequence', 'Email settings'.",
      ),
  }),
  execute: async (input, { experimental_context }) => {
    const path = input.path.trim();
    if (!isNavigablePath(path)) {
      return {
        error:
          "Not an app path. Pass a path under one of: " +
          NAVIGABLE_PREFIXES.join(", "),
      };
    }
    const ctx = (experimental_context as NavToolCtx | undefined) ?? {};
    ctx.writer?.write({
      type: "data-navigate",
      data: { path, label: input.label },
      transient: true,
    });
    return {
      ok: true,
      path,
      label: input.label,
      note: "The page is now open beside this chat, and a button to it is in the transcript. Do not paste the path in your reply; refer to the page by name.",
    };
  },
});
