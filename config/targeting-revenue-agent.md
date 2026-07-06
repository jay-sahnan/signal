# Targeting: Revenue Agent (2.0) — PRIMARY

## Layer 1: Problem Definition

### What specific problem do we solve?

Fintechs gate revenue behind a multi-step onboarding/activation flow — KYC, KYB, licensing, underwriting, or enrollment. A customer, merchant, or plan starts onboarding and gets stuck: a document is missing, an integration fails, a compliance step needs input from a team that never talks to the customer. Nobody chases it to completion. **A stall is revenue that never starts, not a CX metric.** The Revenue Agent reads every onboarding case, finds the stalled ones, and drives them to activation end-to-end with real-time visibility.

### Evidence a company has this problem

- **Non-linear onboarding** — steps run in parallel, so no single queue anyone owns.
- **No timestamp tracking** on where cases stall or why.
- **Client-facing chasing falls entirely on the onboarding team**; internal handoffs leave the client out of the loop.
- **Context lost on reassignment** (Salesforce, Zendesk, spreadsheets).
- **Work spans weeks** — ticket-based tooling cannot hold it together.
- Hiring Onboarding Specialists / Implementation Managers / KYB Analysts to chase cases manually.

### Evidence they're actively trying to solve it

- They already recovered revenue manually once (a batch re-engagement email to dormant/stalled accounts brought money back).
- Unprompted "why didn't I know until days later" language, or asking for an "onboarding specialist end-to-end."
- Build-vs-buy scar tissue: 1-2 years building internal onboarding tooling that never shipped.
- Activation rate / time-to-revenue / merchant ramp reported in board decks or investor updates.

---

## Layer 2: Solution Fit

### How else could they solve this problem?

- **Hire more onboarding/implementation headcount** — scales linearly with volume, never gets ahead of it.
- **Ticketing/CRM workflows** (Zendesk, Salesforce) — can't hold weeks-long, non-linear, multi-team cases together.
- **Generic/horizontal agent builders** — won't do the per-market compliance depth; the customer ends up building everything.
- **Build internally** — the 1-2-year project that never leaves a spreadsheet.

### When is Rulebase's approach superior?

- When onboarding is **non-linear and unowned** — the Revenue Agent owns the stalled case end-to-end and drives it to activation.
- When onboarding **forks per market/regime** (Paystack) — per-market compliance configuration is exactly the depth generic platforms won't touch.
- When they need **execution + real-time visibility**, not another dashboard checked days later.
- When speed matters — production in days, not a multi-year internal build.

### Evidence of these scenarios

- Multi-market / multi-regime onboarding (per-country compliance, LegitScript-style specialist requirements).
- Salesforce/Zendesk/spreadsheet stack for onboarding with no stall tracking.
- Public complaints about "verification stuck", "account opening delays", "waiting weeks to get activated".

---

## Layer 3: Economic Drivers

### Where does this problem have the highest cost of inaction?

- **Payment processors / merchant acquirers** — any stall between doc submission and activation is a merchant that never processes revenue. TPV is the metric.
- **Benefits / HSA-FSA / retirement** — accounts don't fund until enrollment/implementation completes; seasonal volume shocks.
- **Lenders** — a stalled application is a loan never originated.
- **Companies mid-M&A or mid-migration** — a book of accounts that must be re-onboarded on a deadline.

### Drivers of larger deal sizes

- **Recovered revenue** — pricing is justified against revenue recovered, not hours saved. Anchor high (Paystack full rollout ≈ $120K ACV).
- **Onboarding volume + TPV / funded-account value** at stake.
- **Number of markets/regimes** the onboarding flow forks across.
- **Volume shock** from an acquisition, migration, license, or enrollment season.

### Evidence of these characteristics

- Reported activation metric (budget sits with the economic buyer).
- Proof of a manual recovery pass ("$X came back from one email").
- Multi-market license footprint; benefits/enrollment seasonality.

---

## Static vs Dynamic Criteria

### Static Criteria (who could buy)

- Industry: payment processors/acquirers, neobanks & consumer fintech, spend management, benefits/HSA-FSA, retirement/401(k), lenders, remittance — anywhere revenue is gated on verification/enrollment.
- Company size: 50+ employees — **no hard ceiling**; size the deal to recovered revenue, not seats.
- Geography: US, UK, EU, Africa (multi-market processors).
- Buyer owns **revenue**: COO / CRO / CCO + Head/VP/Dir of Onboarding, Implementation, Activation, Merchant Ops, Revenue Ops, Client Services.

### Dynamic Signals (who will buy now)

- M&A / book-of-business transfer (re-onboarding volume shock).
- Sponsor-bank / BaaS change forcing mass re-KYC.
- New market / license approval (new onboarding flow from scratch).
- New COO/CRO/Head of Implementation in last 90 days.
- Activation metric reported in earnings/investor updates.
- Proof of a manual revenue-recovery pass.
- Onboarding/KYB hiring burst (esp. post-funding).
- Open-enrollment window approaching (benefits/retirement).

> **Route away:** instant/self-serve onboarding (no stall), no revenue gate, QA/compliance-only buyers (send to the QA product), horizontal-platform shoppers, data-engineering-first evals. Never run the QA and Revenue Agent pitches into one account at once.
