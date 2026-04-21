import { defineFn } from "@browserbasehq/sdk-functions";

defineFn("env-probe", async (context) => {
  const keys = Object.keys(process.env).sort();
  // Redact anything that looks like a secret (starts with key-ish strings)
  const snippets: Record<string, string> = {};
  for (const k of keys) {
    const v = process.env[k] ?? "";
    if (/KEY|TOKEN|SECRET|PASSWORD/i.test(k)) {
      snippets[k] = v
        ? `len=${v.length} starts=${v.slice(0, 3)}...`
        : "(empty)";
    } else {
      snippets[k] = v.length > 200 ? v.slice(0, 200) + "..." : v;
    }
  }
  return {
    found: true,
    summary: `Dumped ${keys.length} env keys`,
    evidence: [],
    data: {
      sessionId: context.session.id,
      connectUrl: context.session.connectUrl.slice(0, 80) + "...",
      envKeys: keys,
      envSnippets: snippets,
    },
    confidence: "high",
  };
});
