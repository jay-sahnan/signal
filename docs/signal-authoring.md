# Signal Authoring Guide

Load this guide before drafting, editing, or saving any signal. You are the author; the user is the product owner. A signal is a **recipe** — a small, deterministic sequence of tool calls that runs on a schedule and produces a standardized result. Signals are not prompts. Once saved, a signal runs without you.

---

## 1. What makes a good signal

A signal earns its place when every one of these is true:

| Property         | Test                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Actionable       | Can a salesperson change their behavior today because of this?                                                              |
| Evidence-backed  | Every result cites at least one URL and a snippet. No claims without a source.                                              |
| Reproducible     | Two runs on the same company a minute apart return the same `data`. No free-form rephrasing.                                |
| Time-bounded     | The signal clearly says what "new" means — last 30 days, since the last run, etc.                                           |
| Cheap by default | Cheapest tier first (HTTP fetch, Exa). Only escalate to a browser session when the cheap path fails or the page demands JS. |
| Dedupable        | Same finding on two runs produces the same evidence URL — so the UI can collapse them.                                      |

If you cannot satisfy all six, say so to the user and either redefine the scope or decline to save.

---

## 2. The output contract (mandatory)

Every signal returns this shape. No exceptions.

```ts
interface SignalOutput {
  found: boolean; // did the signal fire for this org?
  summary: string; // one sentence, past tense, specific ("Added Stripe to integrations page on 2026-04-14")
  evidence: Array<{
    // at least one item when found=true
    url: string;
    snippet: string; // <=280 chars, quoted from the source
  }>;
  data: Record<string, unknown>; // signal-specific structured payload, stable across runs
  diff?: {
    // only for change-detection signals
    changed: boolean;
    from: unknown;
    to: unknown;
    description: string;
  };
  confidence: "high" | "medium" | "low";
}
```

Rules:

- `found=true` **requires** non-empty `evidence`.
- `summary` must name the thing changed or found — never "a signal was detected".
- `data` is the canonical payload other parts of the system diff against. Keep keys stable across runs (e.g. always `tiers`, not `pricing_tiers` one run and `plans` the next).

---

## 3. Execution services

Pick the simplest service that can produce the contract.

| Service              | Use when                                                                                                                                                                                                                                                      | Avoid when                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `tool_call`          | An existing named tool already does 90% of the job (hiring, GitHub stars, Google reviews).                                                                                                                                                                    | You'd have to post-process the tool's output so much that the recipe becomes unreadable.                |
| `browser_script`     | You need to navigate a page, interact with it (click a toggle, dismiss a cookie banner, expand a "Show more" button), then extract structured content. **Use the `stagehand` recipe step**, not raw Playwright and not `extractWebContent` for this. See §4a. | The page is fully static and you just need to read the HTML once — then `extractWebContent` is cheaper. |
| `exa_search`         | You are looking for recent, news-shaped facts (funding, launches, exec moves) where the source isn't a fixed URL.                                                                                                                                             | You need deterministic extraction of fields from a known URL.                                           |
| `agent_instructions` | **Do not use for new signals.** Deprecated — non-deterministic, non-cacheable.                                                                                                                                                                                | Always.                                                                                                 |

If you feel the pull of `agent_instructions`, stop and decompose the task into tool calls instead.

---

## 4. The toolbox

These are the only tools a signal recipe may invoke.

### Browser (interactive) — **default for anything behind JS or needing clicks**

Use the `stagehand` recipe step. It runs Stagehand on top of Browserbase (a real Chromium session) with natural-language actions and a Zod-backed extraction. Same primitive that powers `scrapeJobListings`. Shape:

```
{
  id: "scrape",
  kind: "stagehand",
  url: "https://{{ context.company.domain }}/pricing",
  actions: [
    { op: "waitMs", ms: 1500 },
    { op: "act", instruction: "If a monthly/annual toggle is present, select monthly." }
  ],
  extract: {
    instruction: "Extract every pricing tier with name, price, period, and top features.",
    schema: { /* JSON Schema: object with a 'tiers' array */ }
  }
}
```

Prefer `stagehand` over raw Playwright for every new signal. Never write literal Playwright selectors inside a recipe. Stagehand handles layout drift across sites; brittle selectors don't.

### Web (static) — cheap path for plain HTML

- `extractWebContent(url)` — Three-tier fallback (HTTP → Browserbase Fetch → full browser session). Returns `{ data: { content, title, description, ... } }`. Use only when the page is fully static. The moment you'd need to click or wait for something, switch to a `stagehand` step.
- `fetchSitemap(domain)` — Discovers URLs on a site. Use to locate `/pricing`, `/integrations`, `/security`, `/customers`, etc. when the URL isn't known.
- `scrapeJobListings(domain)` — Tool-call wrapper around a Stagehand flow specialised for careers pages. Prefer this over writing your own careers signal.

### Search

- `exa_search` (via `exa_search` service config, `{ query, category }`) — Semantic search across news/web/research.

### Enrichment (read-only lookups)

- `enrichCompany`, `enrichCompanies` — Aggregate company profile (website + 3 Exa searches). Use when the signal needs existing enrichment.
- `enrichContact`, `enrichContacts` — LinkedIn + Twitter profile data.
- `getGoogleReviews` — Google Places reviews and rating.
- `fetchGitHubStargazers`, `searchGitHubRepos`, `enrichGitHubProfiles` — GitHub data.

### State (for diff signals)

- `getSignalResults({ signalId, organizationId, maxAgeDays: 90 })` — Previous runs of this signal for this org. **Required for any diff-over-time signal to get its baseline.**

Do not invent tools. If the toolbox is missing something the signal needs, stop and tell the user — a new primitive tool is a separate PR, not something you improvise with `agent_instructions`.

---

## 5. Recipe patterns (snippet library)

### Pattern A — Fixed-URL extraction with Stagehand (pricing, security, integrations, customer logos)

```
1. stagehand step → { url, actions: [wait, optional act to normalise state], extract: { instruction, schema } }
2. On the next turn use a `history` step to load the previous run for this org
3. `diff` step compares current extraction against prior run (keyBy a stable field like tier name)
4. Output builder maps scrape.extracted → data; diff → diff; scrape.url → evidence URL
```

This is the workhorse. Pricing-changes, integrations, customer-logos, security-certs all fit here — only the URL, actions, instruction, and schema differ.

### Pattern B — Static-only fast path

```
1. extractWebContent(url)   ← only when you have reason to believe the page is static
2. extract_json step over fetch.data.content with a Zod schema
3. (optional) history + diff as in Pattern A
```

Use sparingly. Any interaction (toggle, banner, pagination, lazy load) defeats this path.

### Pattern C — News-shaped search (funding, exec moves, launches)

```
1. exa_search with a templated query: "{company} raised OR funding OR series"
2. Filter results to last N days
3. Evidence = top 1-3 results; data = structured fields extracted from titles/snippets
```

### Pattern D — Tool passthrough (hiring, GitHub stars)

```
1. Call the existing tool (e.g. scrapeJobListings) once — it's already a curated Stagehand flow
2. Map its output to the SignalOutput contract
```

---

## 6. Diff-over-time signals

A signal is a _diff signal_ when the user cares about "what changed since last time", not "what is true right now". Examples: pricing changes, homepage copy, customer logos, integration list.

The baseline comes from `getSignalResults` — the most recent prior run for the same `(signalId, organizationId)`. Rules:

- **Never diff raw HTML or markdown.** Extract structured `data` first, then diff that.
- **First run never fires.** On the first run for an org there is no baseline — return `found=false, diff.changed=false`. This is correct behavior, not a bug.
- **Stable keys.** The diff is only useful if `data` keys are stable across runs. Spend the time on the extraction step to guarantee this.
- **Describe the diff in prose.** `diff.description` should read like a changelog entry: "Starter plan went from $29 to $39/mo; added new Business tier at $199/mo."

---

## 7. Creation flow

Saving a signal is a multi-step conversation. Do not skip steps.

1. **Capture intent.** Ask:
   - What fact are you trying to detect, in one sentence?
   - What URL/source proves it?
   - "New" means what — last N days, since last run, ever?
   - What should `summary` look like on a positive result? (Get the user to write one.)
2. **Pick the service** per §3. State your reasoning to the user.
3. **Draft the recipe** as a concrete list of tool calls and transforms. Share it.
4. **Test on 2-3 real companies** from the campaign. If a pre-registered recipe already matches (e.g. `pricing-changes`), use `testSignalRecipe` to dry-run it. Otherwise run each tool in the recipe yourself (you have access to all of them), assemble the `SignalOutput`. Show the user a table: company / found / summary / evidence URL. Include at least one company you expect to be negative.
5. **Iterate.** If evidence is weak, summaries are generic, or reproducibility fails, adjust and re-test.
6. **Save.** Call `createSignal` (or `updateSignal` when editing) only after the user approves the test results. Store the recipe in `config` under a `recipe` key so the runner can execute it later.
7. **Offer to make it public** via `makeSignalPublic` if the signal is generic enough that other users would benefit.

Do not call `createSignal` on the first turn of the conversation. If the user pushes back, explain: a signal is code that runs on their behalf unattended — it has to be tested first.

---

## 8. Worked exemplars

These are the target quality bar. Each one names the service, the recipe outline, and the failure modes you should design around.

### Pricing changes (registered as `pricing-changes`)

- Service: `stagehand` (Pattern A — diff)
- Recipe (abbreviated — see `src/lib/signals/recipes/pricing-changes.ts`):
  1. `stagehand` step visits `https://{domain}/pricing`, picks monthly billing if a toggle exists, expands "Show all plans" if present, then extracts `{ tiers: [{ name, price, period, features[] }] }` with a fixed instruction + schema.
  2. `history` step loads the previous `data.tiers` for this org.
  3. `diff` step compares current vs baseline, keyed by tier name.
  4. Output: `found = diff.changed`, evidence URL = scrape.url, data = full extraction, diff = diff.
- Failure modes: region-gated pricing (add a `waitMs` and an `act` to dismiss the region banner if needed), "Contact us" tiers (record as `price: null`), missing `/pricing` path (next iteration: sitemap fallback before the Stagehand step).

### SOC 2 / ISO certification added

- Service: `stagehand` (Pattern A — diff)
- Recipe:
  1. `stagehand` step visits `/security` (or `/trust`, `/compliance` — pick one; if the signal's domain has none, the step will fail and the user needs to customise the URL). Extract instruction: "List every security or compliance certification or attestation named on this page (SOC 2, ISO 27001, HIPAA, PCI-DSS, etc.). Return them in an array."
  2. Schema: `{ certifications: string[] }`.
  3. `history` + `diff` keyed on certification name. Fire only when a new cert appears.

### Competitor logo on homepage

- Service: `stagehand` (Pattern A)
- Recipe:
  1. `stagehand` step visits the homepage.
  2. Extract instruction uses the competitor list from the recipe config: "Of the following competitor names, which are visibly present on this page (logo, text mention, or customer list)? Return the subset that appear, with the surrounding context."
  3. Schema: `{ mentions: [{ competitor, context }] }`.
- Config: requires `{ competitors: string[] }` baked into the recipe or recipe config. Validate before save.

### New integration listed

- Service: `stagehand` (Pattern A — diff)
- Recipe:
  1. `stagehand` step visits `/integrations` or `/partners`. Action: click any "Show all" or "Load more" button if present. Extract instruction: "List every integration or partner named on this page by its product name only."
  2. Schema: `{ integrations: string[] }`.
  3. `history` + `diff` keyed on integration name. Fire on any added integration.

### Funding round (baseline — already covered by built-in)

- Service: `exa_search` (Pattern C)
- Recipe: `query = "{company} raised OR series OR funding"`, `category = "news"`, filter to last 45 days.
- This one is the template to copy when building other news-shaped signals.

---

## 9. Anti-patterns

- **"The agent will figure it out at runtime."** Not anymore. If the recipe can't be written out as deterministic steps, it is not a signal.
- **Swallowing the source.** Never return a summary without the URL it came from.
- **Variable keys.** `data.tier_one` one run and `data.starter` the next — the diff is meaningless. Normalize at extraction.
- **Scraping the whole site.** A signal targets one fact. Scope the URL list tightly.
- **Running an LLM at execution time to "interpret" output.** The recipe may use one fixed extraction prompt with a schema — that is deterministic enough. It may not use the LLM to "decide what to do next".
- **Writing Playwright selectors directly in a recipe.** Stagehand exists because selectors break across sites. If you catch yourself typing `page.locator(".pricing-tier")` into a recipe, stop — write a Stagehand instruction instead.

---

## 10. When to stop and ask the user

- The required source URL doesn't exist (e.g. company has no pricing page).
- The toolbox is genuinely missing a primitive you'd need.
- The test run returned nothing on 3/3 companies — the signal as written doesn't fire; redesign before saving.
- The user described two signals in one — split them.
