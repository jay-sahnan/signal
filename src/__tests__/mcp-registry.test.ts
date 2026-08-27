import { describe, expect, it } from "vitest";
import { z } from "zod";

import { mcpToolList, toMcpResult } from "@/lib/mcp/registry";

describe("mcp registry", () => {
  it("exposes every agent tool except the UI-only exclusions", () => {
    const names = mcpToolList().map((t) => t.name);
    expect(names).toContain("searchCompanies");
    expect(names).toContain("deleteCompanies");
    expect(names).toContain("openPage");
    // Voice tools need the chat UI's swipe run; useless over MCP.
    expect(names).not.toContain("startVoiceRun");
    expect(names).not.toContain("rewriteVoiceDrafts");
    expect(names).not.toContain("saveVoiceProfile");
    expect(names).toContain("sendEmail");
    for (const t of mcpToolList()) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema).toBeInstanceOf(z.ZodObject);
      expect(typeof t.execute).toBe("function");
    }
  });

  it("serialises results as a single JSON text block", () => {
    expect(toMcpResult({ ok: 1 })).toEqual({
      content: [{ type: "text", text: JSON.stringify({ ok: 1 }, null, 2) }],
    });
    expect(toMcpResult("plain")).toEqual({
      content: [{ type: "text", text: "plain" }],
    });
  });
});
