# Targeting: Complaints

## Layer 1: Problem Definition

### What specific problem do we solve?

Auto finance companies and consumer lenders are failing to identify, capture, and resolve customer complaints consistently — leading to CFPB enforcement actions, state AG investigations, and massive remediation costs. Complaints are buried inside servicing calls, collections conversations, and dealer interactions. Agents misclassify them, skip logging them, or don't recognise them as complaints at all. The CFPB requires firms to identify _all_ expressions of dissatisfaction — not just formal escalations — and most lenders are nowhere close. When the CFPB or a state AG pulls complaint data and finds systematic undercounting, the consequences are severe: consent orders, civil money penalties, and forced remediation programmes that can cost 10-100x what prevention would have.

### Evidence a company has this problem

- **Elevated CFPB complaint volumes**: Searchable in the CFPB Consumer Complaint Database — companies with rising complaint counts in "Vehicle loan or lease", "Consumer loan", or "Debt collection" categories are under pressure
- **High volume of servicing / collections calls**: Large teams handling payment inquiries, loan modifications, repossession disputes, and collections — these are the conversations where complaints hide
- **Manual complaint logging**: Agents are responsible for tagging or escalating complaints themselves — this is error-prone and inconsistent, especially in high-pressure collections environments
- **Dealer network or third-party origination channel**: Complaints arising from the dealer experience (add-on misrepresentation, rate markup) land on the lender but the lender has no visibility into the originating conversation
- **Negative sentiment on public forums**: CFPB complaints, BBB, Trustpilot, Reddit threads showing consumers saying "I tried to complain and nothing happened" or "they ignored my dispute"
- **State AG complaints**: State attorneys general track complaint volumes and use them to prioritise investigations — companies with high volumes in specific states are at risk

### Evidence they're actively trying to solve it

- Job postings for "Complaints Manager", "Consumer Complaints Analyst", "Customer Experience / Outcomes" roles — especially in servicing or collections departments
- References to "complaint management system", "UDAAP risk", "root cause analysis", or "complaint taxonomy" in job descriptions
- Recent CFPB consent order or state AG settlement that specifically requires enhanced complaint identification and monitoring
- Hiring a Chief Compliance Officer, Head of Consumer Affairs, or VP of Regulatory Relations (often triggers complaints overhaul)
- CFPB supervisory exam preparation — compliance teams know when exams are coming and scramble to shore up complaint capture
- Published annual reports or investor decks mentioning complaint reduction targets or complaint handling improvement initiatives

---

## Layer 2: Solution Fit

### How else could they solve this problem?

- **Train agents to identify complaints better** — ongoing coaching (helps but doesn't catch what humans miss, especially in high-volume servicing and collections environments)
- **Manual review / QA sampling** — compliance team listens to a sample of calls and checks for missed complaints (doesn't scale, catches a tiny fraction)
- **CRM-based keyword rules** — build complaint detection triggers in Salesforce, loan servicing platform, or telephony system (keyword-based, brittle, high false positive rate, can't understand context)
- **Speech analytics incumbents** — CallMiner, Verint, NICE (expensive, 6-12 month deployments, require dedicated admin teams, often overkill for mid-market lenders)
- **Build internally** — data science team builds NLP models for complaint detection (high build cost, ongoing maintenance, rarely keeps pace with regulatory changes)

### When is Rulebase's approach superior?

- When the lender needs to detect complaints **across 100% of servicing, collections, and sales interactions** — not just the ones agents flag. Rulebase AI analyses every conversation and identifies expressions of dissatisfaction automatically, including implicit complaints that agents routinely miss
- When they need **complaint detection tightly integrated with QA and compliance monitoring** — auto lenders and consumer lenders don't need three separate tools for quality, compliance, and complaints. Rulebase scores all three in a single pass
- When they need **audit-ready evidence** — Rulebase provides specific citations (quotes, timestamps) for each complaint finding, which is exactly what CFPB examiners and state AGs request during investigations
- When **speed to deploy matters** — firms under consent orders or facing an upcoming CFPB exam can't wait 6-12 months. Rulebase integrates with existing telephony and CRM in days to weeks
- When they're a **mid-market lender** — too large for manual monitoring, too small to justify a $500K+ enterprise speech analytics platform and the headcount to run it
- When complaint **severity and categorisation matters** — not just "complaint / not complaint" but risk-scored, categorised by type (billing, servicing, collections, origination), and routed to the right handler

### Evidence of these scenarios

- Mid-market auto lender or consumer lender ($1B-$20B portfolio — large enough for real risk, not so large they've already bought CallMiner)
- CFPB-supervised entity (check larger participant rules: >$10B in auto loan originations)
- No existing speech analytics vendor (check job posts, tech stack databases — absence signals greenfield opportunity)
- Existing cloud telephony or CRM stack (RingCentral, Five9, Talkdesk, Salesforce — integration-ready)
- Recent consent order specifically citing complaint handling deficiencies
- High CFPB complaint volume relative to peers (searchable, rankable)

---

## Layer 3: Economic Drivers

### Where does this problem have the highest cost of inaction?

- **Auto finance companies**: The CFPB treats auto lending as a top enforcement priority. Complaint handling failures have been central to major consent orders — Ally Financial ($98M), Capital One Auto ($150M+), Westlake Financial ($44M). Missed complaints are often the _evidence trail_ that triggers the broader investigation
- **Subprime and near-prime lenders**: Higher complaint rates by nature (consumers under financial stress), more aggressive collections, and intense regulatory scrutiny. A systemic failure to capture complaints is practically an invitation for enforcement
- **Consumer lenders post-enforcement**: Companies already under consent orders that require "enhanced complaint management" — the cost of a second failure includes enhanced penalties, potential licence revocation, and personal executive liability
- **Lenders with large servicing portfolios**: Servicing generates the most complaints (payment processing, escrow, loss mitigation, collections). A lender servicing 500K+ loans has thousands of complaint-risk conversations daily
- **Multi-state lenders**: Each state has its own consumer complaint requirements on top of federal. State AGs increasingly coordinate multi-state investigations — a complaint handling failure in one state can cascade

### Drivers of larger deal sizes

- **Interaction volume**: More servicing/collections calls = more conversations to analyse. A lender servicing 500K loans will generate far more volume than one with 50K
- **Dealer network size**: Auto finance companies with 1,000+ dealer relationships have indirect origination complaint risk on top of servicing complaints
- **Regulatory pressure**: Firms under consent orders or enhanced CFPB supervision invest more aggressively (and faster) — urgency compresses sales cycles and increases willingness to pay
- **Multi-entity operations**: Holding companies with multiple lending subsidiaries or licensed entities across states
- **Expansion from complaints into QA and compliance**: Complaints detection is often the entry point — once deployed, the same platform extends to full QA and sales compliance monitoring (land and expand)

### Evidence of these characteristics

- CFPB complaint database showing high complaint volumes for the company (public, searchable, rankable against peers)
- CFPB consent orders or state AG settlements citing complaint handling failures (public record)
- Large servicing portfolio (visible from ABS filings, annual reports, or press releases)
- High headcount in servicing and collections roles on LinkedIn
- NMLS records showing multi-state licensing
- Recent PE acquisition (PE-backed lenders often have compliance maturity gaps post-acquisition)
- Origination volume or portfolio size in auto finance industry rankings (e.g., Experian's State of Auto Finance reports)

---

## Static vs Dynamic Criteria

### Static Criteria (who could buy)

- **Industry vertical**: Auto finance (captive, independent, BHPH), consumer lending (personal loans, installment), mortgage servicing, student loan servicing, credit unions with auto/consumer lending
- **Regulatory status**: CFPB-supervised (larger participants), state-licensed (NMLS), state AG jurisdiction
- **Business model**: Direct-to-consumer lending, indirect/dealer-originated, servicing and collections operations
- **Agent headcount**: 30+ servicing, collections, or customer-facing agents
- **Geography**: US (CFPB, state AGs, state licensing)
- **Company size**: 200-5,000 employees
- **Portfolio size**: $1B+ in loans originated or serviced (enough volume for complaints to be a systemic risk)
- **Tech stack**: Cloud telephony (Five9, Talkdesk, RingCentral, Genesys), Salesforce, loan servicing platforms

### Dynamic Signals (who will buy now)

- **CFPB consent order in last 12 months citing complaint handling deficiencies** — compelled buyer, must improve
- **Rising CFPB complaint volume** — quarter-over-quarter increase visible in public data, often precedes enforcement
- **State AG investigation or multi-state settlement announced**
- **CFPB exam cycle** — larger participants know when exams are approaching; compliance hiring and tool evaluation spikes
- **New CCO, Head of Consumer Affairs, or Complaints Director hired in last 90 days** — new leadership triggers tooling overhaul
- **Recent PE acquisition** — new owners want compliance risk quantified and controlled
- **Subprime delinquency spikes** — when delinquencies rise, collections call volumes surge, and complaint risk multiplies
- **CFPB annual enforcement priority announcements naming auto lending or servicing practices**
- **Job postings referencing "complaint management system", "complaint taxonomy", "UDAAP monitoring", or "complaint root cause analysis"**
- **BBB/Trustpilot complaint surge** — public-facing complaint spike often mirrors what's happening internally

---

## US Auto Finance & Lending Complaints Landscape

### Why complaints are the #1 regulatory risk vector in auto finance

- Complaints are the **canary in the coal mine** for regulators. The CFPB explicitly uses consumer complaint data to prioritise supervisory exams and enforcement investigations. Rising complaint volumes for a lender are a leading indicator of regulatory action
- The CFPB Consumer Complaint Database is **public and searchable** — journalists, state AGs, and plaintiffs' attorneys all use it to identify targets. A lender with a high complaint rate has a bullseye on them
- **Complaint categorisation is broken** at most lenders. The CFPB doesn't just want to know you received a complaint — they want to see that you identified the root cause, categorised it correctly, resolved it within required timeframes, and used the data to prevent recurrence. Most lenders can't do this because they're only capturing complaints agents manually log

### Highest-risk complaint categories in auto finance

| Category                         | Why it matters                                                                | Regulatory risk                      |
| -------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------ |
| **Billing / payment processing** | Misapplied payments, late fee disputes, payoff quote errors                   | UDAAP, state consumer protection     |
| **Loan modification / hardship** | Failure to offer or process modification requests                             | UDAAP, SCRA, fair lending            |
| **Repossession**                 | Wrongful repo, failure to provide required notices, personal property issues  | UDAAP, SCRA, state repo laws         |
| **Add-on products**              | GAP, VSC, extended warranty — cancellation refund failures, misrepresentation | UDAAP, state insurance regulations   |
| **Collections practices**        | Harassment, misrepresentation of debt, contacting wrong parties               | FDCPA, UDAAP, state collections laws |
| **Credit reporting**             | Inaccurate reporting, failure to investigate disputes                         | FCRA, UDAAP                          |

### Key segments to target

| Segment                               | Complaint risk profile                                                      | Examples                                                 |
| ------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Independent subprime auto lenders** | Highest complaint rates, most CFPB scrutiny                                 | Westlake, Credit Acceptance, DT Acceptance, CAC Holdings |
| **Large captive finance companies**   | Massive volume, public brand exposure                                       | Ally Financial, GM Financial, Toyota Motor Credit        |
| **BHPH dealer groups**                | Aggressive collections, vulnerable consumers                                | DriveTime, CarMax Auto Finance                           |
| **Digital / fintech auto lenders**    | Fast-growing, compliance infrastructure lagging growth                      | Caribou, Lendbuzz, Vroom Financial                       |
| **Consumer installment lenders**      | High origination volume, servicing complaint risk                           | LendingClub, Upgrade, Avant, Best Egg, Oportun           |
| **Mortgage servicers**                | Highest regulatory complaint burden (CFPB's most-complained-about category) | loanDepot, Newrez, Mr. Cooper, Flagstar                  |
