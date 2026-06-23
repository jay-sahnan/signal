# Targeting: Sales Compliance

## Layer 1: Problem Definition

### What specific problem do we solve?

Sales teams at regulated lenders and auto finance companies are having conversations with consumers that violate federal and state regulations — and nobody catches it until an examiner or lawsuit does. Agents are misrepresenting loan terms, skipping required disclosures (TILA, ECOA, SCRA), steering consumers into products that aren't in their best interest, or using high-pressure tactics that trigger UDAAP violations. These violations happen live on calls and in chats, and the company has zero systematic way to detect them across 100% of interactions. The result: consent orders, multi-million dollar fines, and forced remediation programmes that dwarf the cost of prevention.

### Evidence a company has this problem

- **Large outbound or inbound sales teams**: 20+ loan officers, BDCs (Business Development Centers), or sales agents handling consumer credit conversations — more reps = more compliance surface area
- **CFPB or state AG enforcement history**: Public consent orders, civil money penalties, or supervisory actions for UDAAP, fair lending, or TILA violations (all searchable on CFPB and state AG websites)
- **Manual compliance monitoring**: Compliance team relies on call listening, ride-alongs, or spot-checks of a tiny sample — this is the same broken model as manual QA, applied to compliance
- **Complex product set**: Multiple loan products, rate structures, add-on products (GAP, VSC, extended warranties in auto finance) — complexity breeds misrepresentation
- **Decentralised sales operations**: Dealer network, broker channel, or multiple branch locations — the further sales reps are from compliance, the higher the violation rate
- **Incentive structures tied to volume or product mix**: Commission plans that reward upselling or specific product attachment rates create misaligned incentives

### Evidence they're actively trying to solve it

- Job postings for "Sales Compliance Analyst", "Compliance Monitoring Specialist", or "Fair Lending Officer"
- CFPB exam preparation activity (visible through compliance hiring surges or consultant engagements)
- References to "sales practice monitoring", "UDAAP risk", or "fair lending testing" in job descriptions
- Recent hire of a Chief Compliance Officer, Head of Regulatory Affairs, or VP of Risk
- Published consent orders requiring enhanced monitoring programmes (firms under these orders _must_ improve — they're compelled buyers)
- State licensing activity or multi-state expansion (new states = new compliance requirements)

---

## Layer 2: Solution Fit

### How else could they solve this problem?

- **Manual call monitoring** — compliance analysts listen to a sample of calls and score them (doesn't scale, catches <5% of violations)
- **Speech analytics incumbents** — CallMiner, Verint, NICE — heavyweight enterprise platforms (expensive, 6-12 month deployments, often require dedicated admin teams)
- **Post-hoc audit** — internal audit or external consultants review call samples periodically (retrospective, not preventive, gaps between reviews)
- **Training and coaching only** — annual compliance training and manager coaching (necessary but insufficient — training doesn't catch violations in real-time)
- **Build internally** — data/engineering team builds keyword spotting or NLP models (high build cost, ongoing maintenance, rarely keeps pace with regulatory changes)

### When is Rulebase's approach superior?

- When the company needs **100% conversation coverage** for compliance monitoring — not a 2% sample that misses systemic violations. Rulebase AI evaluates every call, chat, and email against compliance criteria automatically
- When they need compliance monitoring that's **tightly coupled with QA** — sales quality and sales compliance aren't separate problems, they're two lenses on the same conversation. Rulebase scores both in a single workflow
- When they need to be **audit-ready with citations** — Rulebase provides specific evidence (quotes, timestamps) for each compliance finding, not just a flag. This is what examiners want to see
- When **speed to deploy matters** — firms under consent orders or facing upcoming exams can't wait 6-12 months for a Verint rollout. Rulebase integrates with existing platforms (Zendesk, Aircall, telephony systems) in days to weeks
- When they're a **mid-market lender** — too large for manual monitoring, too small to justify a $500K+ enterprise speech analytics platform and the headcount to run it. Rulebase fills this gap
- When they have a **dealer or broker network** — decentralised sales channels are the highest-risk and hardest to monitor. Rulebase can ingest calls from distributed locations and apply consistent compliance criteria

### Evidence of these scenarios

- Mid-market auto lender or consumer lender (visible from company size, AUM, or loan volume in public filings / press)
- Active CFPB supervision (check CFPB enforcement database and larger participant rules)
- Existing Zendesk, Aircall, or cloud telephony stack (integration-ready)
- No existing speech analytics vendor (check job posts, tech stack databases — absence of Verint/CallMiner/NICE signals greenfield opportunity)
- Dealer network or multi-branch model (visible from website, dealer locator pages, or franchise disclosures)
- Recent consent order requiring "enhanced monitoring" or "compliance management system improvements"

---

## Layer 3: Economic Drivers

### Where does this problem have the highest cost of inaction?

- **Auto finance companies**: The CFPB has made auto lending a top enforcement priority. Discriminatory markup policies, add-on product misrepresentation, and SCRA violations have driven consent orders ranging from $10M to $100M+ (Ally Financial: $98M, Capital One Auto: $150M+, Westlake Financial: $44M). A single enforcement action can exceed a decade of compliance tooling spend
- **Consumer lenders (personal loans, mortgage, student lending)**: UDAAP, TILA, ECOA, and fair lending violations carry both direct penalties and reputational damage. Lenders with large origination volumes face the most examiner scrutiny
- **Buy-Here-Pay-Here (BHPH) dealers**: Often targeting subprime consumers and under intense state AG scrutiny. High complaint rates and aggressive sales tactics make them enforcement magnets
- **Firms under existing consent orders**: The cost of a _second_ violation while under an active order is exponentially worse — enhanced penalties, potential licence revocation, and personal liability for executives
- **Multi-state lenders**: Each state has its own consumer protection rules on top of federal requirements. A sales compliance violation in one state can trigger multi-state investigations (state AG coalitions)

### Drivers of larger deal sizes

- **Sales headcount and call volume**: More loan officers / BDC agents = more conversations to monitor = higher platform consumption
- **Dealer network size**: Auto finance companies with 1,000+ dealer relationships need compliance monitoring across all of them
- **Product complexity**: More loan products and add-ons = more compliance rules to evaluate per conversation
- **Regulatory pressure**: Firms under consent orders or enhanced supervision will invest more aggressively (and faster) in compliance infrastructure
- **Multi-entity / multi-state operations**: Holding companies with multiple lending entities or licenses across 20+ states

### Evidence of these characteristics

- NMLS records showing multi-state licensing (searchable on NMLS Consumer Access)
- CFPB consent orders or state AG settlements (public record — CFPB enforcement actions database, state AG press releases)
- Large dealer network (visible from company website, dealer portal, or auto finance industry rankings)
- Origination volume or portfolio size mentioned in annual reports, ABS filings, or press releases
- High loan officer or BDC headcount on LinkedIn (20+ sales agents)
- Recent funding round or PE acquisition (PE-backed auto lenders and consumer lenders often face compliance growing pains post-acquisition)
- CFPB complaint database showing elevated complaint volumes for the company

---

## Static vs Dynamic Criteria

### Static Criteria (who could buy)

- **Industry vertical**: Auto finance (captive, independent, BHPH), consumer lending (personal loans, installment lending), mortgage origination, student lending, credit unions with lending operations
- **Regulatory status**: CFPB-supervised (larger participants in auto lending >$10B originations, or other larger participant thresholds), state-licensed lenders (NMLS)
- **Business model**: Direct-to-consumer lending, indirect lending via dealer networks, or hybrid
- **Sales headcount**: 20+ loan officers, BDC reps, or sales agents
- **Geography**: US (CFPB, state AG, state licensing)
- **Company size**: 200-5,000 employees (mid-market sweet spot — large enough to have real compliance risk, not so large they've already bought Verint)
- **Tech stack**: Cloud telephony (RingCentral, Dialpad, Aircall, Five9, Talkdesk), Salesforce, CRM-based workflows

### Dynamic Signals (who will buy now)

- **CFPB consent order issued in last 12 months** — firm is under mandate to improve compliance monitoring (compelled buyer)
- **State AG investigation or settlement announced** — similar urgency
- **CFPB exam cycle** — larger participants know when exams are coming; compliance hiring spikes signal preparation
- **Spike in CFPB complaints** — searchable in the CFPB complaint database; rising complaints often precede enforcement
- **New CCO, Head of Compliance, or VP Risk hired in last 90 days** — new leadership = new tooling evaluations
- **Recent PE acquisition or IPO preparation** — PE firms want clean compliance; IPO readiness requires robust monitoring
- **Multi-state expansion** — applying for new state licenses (NMLS filings) means new compliance requirements
- **Add-on product controversy** — GAP insurance, VSC, or ancillary product scrutiny in press or regulator statements
- **Job posting referencing "sales practices", "UDAAP", "fair lending testing", or "compliance monitoring automation"**
- **Annual CFPB enforcement priority announcements** — when auto lending or specific practices are named as priorities, every firm in the space starts evaluating tools

---

## US Auto Finance & Lending Landscape: Key Context

### Why auto finance is a high-value vertical right now

- The CFPB under the current administration has intensified auto lending enforcement, with particular focus on:
  - **Dealer markup / discretionary pricing** (fair lending / ECOA risk)
  - **Add-on products** (GAP, extended warranties, service contracts) — misrepresentation and force-placement
  - **SCRA violations** (repossessions and interest rate caps for servicemembers)
  - **Junk fees** — hidden charges and payment allocation manipulation
- State AGs are increasingly coordinating multi-state investigations into auto lending practices
- The FTC's Combating Auto Retail Scams (CARS) Rule has heightened scrutiny on the entire dealer-to-lender chain
- Subprime auto delinquencies are elevated, which historically triggers more examiner attention and enforcement

### Key auto finance segments to target

| Segment                             | Why                                                                   | Examples                                                |
| ----------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| **Independent auto finance**        | Highest risk profile — subprime focus, dealer networks, CFPB scrutiny | Westlake, DT Acceptance, Credit Acceptance, AmeriCredit |
| **Captive finance arms**            | Massive volume, brand reputation risk, regulatory spotlight           | Ford Motor Credit, GM Financial, Toyota Financial       |
| **BHPH dealer groups**              | Aggressive sales, vulnerable consumers, state AG targets              | DriveTime, Carvana (financing arm), CarMax Auto Finance |
| **Credit unions with auto lending** | Growing auto portfolios, less mature compliance infrastructure        | Navy Federal, PenFed, Alliant                           |
| **Digital/fintech auto lenders**    | Fast-growing, scaling sales teams, often pre-IPO compliance pressure  | Caribou, Lendbuzz, Vroom Financial                      |

### Key consumer lending segments to target

| Segment                                  | Why                                                                     | Examples                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Personal loan / installment lenders**  | High volume origination, UDAAP and TILA risk on every call              | LendingClub, Upgrade, Avant, Best Egg                                 |
| **Mortgage originators**                 | TILA-RESPA, fair lending, heavy compliance burden on loan officer calls | loanDepot, Guaranteed Rate, UWM                                       |
| **Student loan servicers / originators** | Heightened CFPB scrutiny, complex disclosure requirements               | SoFi, Earnest, College Ave                                            |
| **PE-backed lending platforms**          | Growth pressure vs compliance maturity gap                              | Various portfolio companies of Warburg Pincus, KKR, Apollo in lending |
