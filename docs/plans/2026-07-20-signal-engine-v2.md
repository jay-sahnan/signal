# Signal Engine v2 — 3-Lane Grounded Catalogue & Plan

_Derived from ~35 sales/customer accounts mined from Granola (May 2025–Jul 2026) + the GTM playbook. Goal: highest-precision signals that find buyers about to move, grounded in real call evidence. Confirmed 2026-07-20._

## The three lanes (product motions)

| Lane                        | What it is                                                                                                                          | Pitch                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **1 — AI QA**               | QA over **AI bots + human agents**; cost-reduction of AI CX platforms (Sierra-class)                                                | "You run Sierra/Decagon/Fin + humans → we grade the AI _and_ the humans and cut the cost" |
| **2 — Long-horizon tasks**  | Multi-step, time-spanning **customer + growth** ops (activation, reactivation, retention, onboarding-over-weeks, dispute lifecycle) | "Agents that pursue an outcome over days/weeks, not one ticket"                           |
| **3 — AI for customer ops** | Front-line **ops agents that handle interactions end-to-end** (Gradient Labs approach)                                              | "Agents that run the ops, not just watch them"                                            |

**Market cut (spans all three lanes):** SMBs across **regulated industries, FS-led.** FS is the beachhead (proof + reference base); expand to other regulated verticals where conversations carry compliance risk: health/telehealth, insurance/insurtech, legal, iGaming/betting, debt-collection/ARM, telecom/utilities, edtech, pharma/cannabis.

## Data-source architecture

Signal-engine recipes call only the in-process toolbox (`exa_search`, `stagehand`/`extractWebContent`, `scrapeJobListings`, `enrichCompany`, `getGoogleReviews`, GitHub, `getSignalResults`). **Crustdata and Apollo are new primitive tools** (registry addition + PR).

- **Exa** (have it) → narrative/event signals: AI-platform deployments, funding, launches, exec moves, consent orders, "migrating off X".
- **`scrapeJobListings`** (have it) → all hiring signals.
- **`getGoogleReviews`** / stagehand (have it) → review/complaint-surge + on-site Zendesk/Intercom widget detection (per-account verification).
- **Crustdata** (new tool; auth pending via `/mcp`) → technographics (CX platform, AI-CX platform, QA tool), department headcount trends, exec/decision-maker changes.
- **Apollo** (new tool; already paid) → firmographic + industry filtering (SMB + regulated), verified contacts, technographics fallback.
- BuiltWith considered and **dropped** for now.

## What the calls showed (empirical basis, ~35 accounts)

- **"Manual QA at scale" is the market, not a signal** — pair it with a forcing function.
- 🥇 **Incumbent QA-tool displacement converts best** (Kuda, Rho, Qonto, Nala, Spendesk all displaced PlayVox/EvaluAgent/MaestroQA/Ripit/Level AI/PerformLine/Klaus). Fastest near renewal → **Lane 1**.
- **Onboarding/activation revenue leak after growth** = strongest recent win cluster (Wayflyer, Coast, RWA, Paystack, Vestwell) → **Lanes 2/3**.
- **New CX/Quality/Risk leader <90d** = urgency (FairMoney, Relay, Emburse, Novo, Pleo), medium conversion.
- 🚫 **Negative signal** (biggest losses — Relay, Ramp, Stash, Zolve, Capital One, Bill.com): engineering-first / Claude-LLM-native "build it ourselves" cultures. Encode as a suppressor. Also: single-champion/no-budget; <5k tickets/mo; enterprise bank in procurement; needs deep back-office integration to start.

## Golden profile (FS beachhead → lookalikes)

Regulated, revenue-generating company; SMB up through scale-up; real compliance obligation. **Zendesk/Intercom/Freshdesk** + **no or legacy QA tool**; SOPs in Notion/Drive/Confluence. Support org of 10–600+ agents, heavy BPO/multi-region; small QA function (3–35% manual coverage) + adjacent compliance team. Named **Head of CX / Head of Quality** champion (ideally recently hired). Strongest in Africa & Europe; US skews to onboarding/business-banking.

## Signal catalogue by lane

### Lane 1 — AI QA

| Signal                        | Detects                                                                                            | Source                                   | Now?                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------- |
| AI-CX platform deployed       | Running Sierra/Decagon/Ada/Intercom Fin/Zendesk AI (AI to grade)                                   | Exa + Crustdata technographics           | Exa now; tech needs Crustdata |
| Zendesk/Intercom + human org  | Real contact center to QA                                                                          | Crustdata/Apollo technographics          | needs tool                    |
| QA-tool displacement          | MaestroQA/EvaluAgent/PlayVox/Klaus/Level AI/PerformLine/Ripit in stack, or "migrating off X" posts | technographics + `scrapeJobListings`/Exa | partly now                    |
| Support headcount (cost base) | Large/growing human support = cost to cut                                                          | Crustdata headcount                      | needs Crustdata               |
| QA/Quality hiring             | Building QA manually                                                                               | `scrapeJobListings`                      | ✅ now                        |

### Lane 2 — Long-horizon tasks

| Signal                                          | Detects                              | Source                    | Now?    |
| ----------------------------------------------- | ------------------------------------ | ------------------------- | ------- |
| Onboarding/activation/underwriting hiring       | Manual multi-step onboarding scaling | `scrapeJobListings`       | ✅ now  |
| Funding / growth event                          | Volume/backlog about to spike        | Exa + Crustdata headcount | Exa now |
| Reactivation / churn / dormant-account language | Revenue leak over time               | Exa + `scrapeJobListings` | ✅ now  |
| New market / license launch                     | New onboarding flow per market       | Exa + `scrapeJobListings` | ✅ now  |

### Lane 3 — AI for customer ops

| Signal                               | Detects                                                 | Source                                   | Now?       |
| ------------------------------------ | ------------------------------------------------------- | ---------------------------------------- | ---------- |
| High front-line volume + manual ops  | Ops ripe for autonomous agents                          | Crustdata headcount + `getGoogleReviews` | partly now |
| Evaluating autonomous support agents | In-market for ops agents (Gradient Labs/Sierra/Decagon) | Exa                                      | ✅ now     |
| Support/BPO hiring at scale          | Linear-scaling ops cost                                 | `scrapeJobListings` + Crustdata          | ✅ now     |
| Regulated front-line workflows       | Compliance-sensitive interactions                       | industry classifier (Apollo) + Exa       | partly     |

### Cross-lane

- **Runs Zendesk/Intercom/Freshdesk** (installed-base screen) — technographics.
- **SMB + regulated-industry firmographics** (FS-led) — Apollo.
- 🚫 **Internal-build / Claude-native suppressor** — Exa + `scrapeJobListings` (AI/ML eng for internal QA; "built our own"). ✅ now.

## Phasing

- **Phase 1 (now, no new deps):** author `SignalRecipe`s for the ✅-now signals — Lane 2 (onboarding hiring, funding, reactivation, new-market), Lane 3 (evaluating-agents, support hiring), Lane 1 (QA hiring), + review-surge + internal-build suppressor. PR into `signal-engine`.
- **Phase 2 (after Crustdata auth):** add Crustdata primitive tool → technographics (CX/AI-CX platform, QA tool), headcount trends, exec-change. Unlocks the Lane-1 flagship + the installed-base screen.
- **Phase 3:** add Apollo primitive tool for SMB + regulated-industry firmographic filtering + contacts; lookalike TAM from the golden profile.
- **Phase 4:** per-lane scoring/tiering + routing; enriched Smartlead CSV output (no Slack). Call-mining refresh loop.
