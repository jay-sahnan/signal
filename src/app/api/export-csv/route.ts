import { getAdminClient } from "@/lib/supabase/admin";

function esc(value: string | null | undefined): string {
  if (!value) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(request: Request) {
  const supabase = getAdminClient();

  const { searchParams } = new URL(request.url);
  const preset = searchParams.get("preset");
  const campaignId = searchParams.get("campaignId");

  // Get campaign IDs
  let campaignIds: string[] = [];
  if (preset) {
    const { data } = await supabase
      .from("campaigns")
      .select("id")
      .eq("icp_preset_slug", preset);
    campaignIds = (data ?? []).map((c) => c.id as string);
  } else if (campaignId) {
    campaignIds = [campaignId];
  }

  if (campaignIds.length === 0)
    return new Response("No campaigns found", { status: 404 });

  // Get the preset slug for outreach generation
  const presetSlug = preset ?? "qa";

  // Fetch companies
  const { data: companyRows } = await supabase
    .from("campaign_organizations")
    .select(
      `
      relevance_score, score_reason, status, suggested_approach,
      organization:organizations!inner(id, name, domain, industry, location, enrichment_data)
    `,
    )
    .in("campaign_id", campaignIds)
    .order("relevance_score", { ascending: false, nullsFirst: false })
    .limit(100);

  // Fetch contacts
  const { data: contactRows } = await supabase
    .from("campaign_people")
    .select(
      `
      priority_score, generated_email_subject, generated_email_body,
      person:people!inner(name, work_email, personal_email, title, linkedin_url, organization_id)
    `,
    )
    .in("campaign_id", campaignIds)
    .order("priority_score", { ascending: false, nullsFirst: false })
    .limit(300);

  // Contact map by org ID
  const contactMap = new Map<string, Array<Record<string, unknown>>>();
  for (const cr of (contactRows ?? []) as unknown as Array<
    Record<string, unknown>
  >) {
    const person = cr.person as Record<string, unknown>;
    const orgId = person?.organization_id as string;
    if (!orgId) continue;
    if (!contactMap.has(orgId)) contactMap.set(orgId, []);
    contactMap.get(orgId)!.push({ ...cr, person });
  }

  // Fetch signal results
  const orgIds = (
    (companyRows ?? []) as unknown as Array<Record<string, unknown>>
  )
    .map((c) => {
      const org = c.organization as Record<string, unknown>;
      return org.id as string;
    })
    .filter(Boolean);

  const signalAccum = new Map<string, string[]>();
  if (orgIds.length > 0) {
    const { data: signalRows } = await supabase
      .from("signal_results")
      .select("organization_id, output, signal:signals!inner(name)")
      .in("organization_id", orgIds)
      .eq("status", "success")
      .order("ran_at", { ascending: false })
      .limit(300);

    for (const sr of (signalRows ?? []) as unknown as Array<
      Record<string, unknown>
    >) {
      const orgId = sr.organization_id as string;
      const output = sr.output as Record<string, unknown>;
      const signal = sr.signal as Record<string, unknown>;
      if (!output?.found) continue;
      if (!signalAccum.has(orgId)) signalAccum.set(orgId, []);
      const list = signalAccum.get(orgId)!;
      if (list.length < 3) {
        list.push(
          `${signal.name}: ${((output.summary as string) ?? "").slice(0, 80)}`,
        );
      }
    }
  }

  // CSV header — includes score for Smartlead priority sorting
  const header =
    "company,score,signal,contact_name,contact_title,email,linkedin,suggested_path,personalised_email,personalised_linkedin,creative_play";

  const csvRows: string[] = [];

  for (const row of (companyRows ?? []) as unknown as Array<
    Record<string, unknown>
  >) {
    const org = row.organization as Record<string, unknown>;
    const orgId = org.id as string;
    const companyName = org.name as string;
    const signalJoined = (signalAccum.get(orgId) ?? []).join(" | ");
    const signal = signalJoined || ((row.score_reason as string) ?? "");

    const contacts = contactMap.get(orgId) ?? [];

    // Build signal-aware messages directly from the data
    const sl = signal.toLowerCase();
    const hasRegulatory =
      sl.includes("consent order") ||
      sl.includes("enforcement") ||
      sl.includes("cfpb") ||
      sl.includes("regulatory");
    const hasTrustpilot =
      sl.includes("trustpilot") ||
      sl.includes("review deterioration") ||
      sl.includes("rising cfpb complaint") ||
      sl.includes("complaint");
    const hasNewLeader =
      sl.includes("leader hired") ||
      sl.includes("new compliance") ||
      sl.includes("appointed");
    const hasPE =
      sl.includes("pe acquisition") ||
      sl.includes("ownership change") ||
      sl.includes("acquired");
    const hasHiring =
      sl.includes("job posting") ||
      sl.includes("hiring") ||
      sl.includes("cx team scaling");
    const hasAI = sl.includes("ai agent") || sl.includes("ai chatbot");
    const hasUDAAP = sl.includes("udaap") || sl.includes("sales practice");
    function makeEmail(firstName: string): string {
      const name = firstName || "there";
      // Route by signal — the signal IS the reason to write
      if (hasRegulatory) {
        return `Hi ${name},\n\nThe recent regulatory activity around ${companyName} caught my attention. The pattern we see: complaint detection is almost always the root cause. Agents manually log maybe 30% of actual dissatisfaction — the rest goes undetected until it compounds into enforcement.\n\nWe built Rulebase for exactly this — AI that detects every complaint across every call, with auditable evidence.\n\nWorth 15 minutes?`;
      }
      if (hasTrustpilot) {
        return `Hi ${name},\n\n${companyName}'s public reviews paint a picture — and what we consistently see is that reviews are just the tip. For every Trustpilot complaint, there are 5-10 expressions of dissatisfaction buried in calls that never get logged.\n\nRulebase surfaces all of them automatically. No manual tagging, no missed complaints.\n\nOpen to a quick look?`;
      }
      if (hasNewLeader) {
        return `Hi ${name},\n\nFirst 90 days in a new role is when you audit what's actually happening vs what people tell you. Most leaders discover QA covers 1-3% of conversations and complaint detection is manual.\n\nRulebase gives you full visibility — 100% conversation evaluation — from day one.\n\nWorth 15 min to see if it's relevant for ${companyName}?`;
      }
      if (hasPE) {
        return `Hi ${name},\n\nPost-acquisition, the compliance picture is always murkier than expected. New ownership wants clean books — but most lenders can only show compliance coverage on 2-3% of conversations.\n\nRulebase monitors 100% with auditable evidence. Makes the risk quantifiable.\n\nRelevant for what ${companyName} is going through?`;
      }
      if (hasUDAAP) {
        return `Hi ${name},\n\nSales reps skip or botch required disclosures on roughly 10-15% of calls. At ${companyName}'s scale, that's hundreds of violations per month nobody catches until an examiner does.\n\nRulebase listens to every call and flags the gaps in real time.\n\nRelevant?`;
      }
      if (hasAI) {
        return `Hi ${name},\n\nSaw ${companyName} is deploying AI for CX — which raises a question most teams hit next: who QAs the AI? Manual sampling doesn't work when half your conversations are AI-handled.\n\nRulebase evaluates 100% of both human and AI conversations. Worth a look?`;
      }
      if (hasHiring) {
        return `Hi ${name},\n\nNoticed ${companyName} is building out the CX/compliance team. The first thing new leaders find is that QA covers 1-3% of conversations — not enough to spot systemic issues.\n\nRulebase gets you to 100% in days. Worth 15 min?`;
      }
      if (presetSlug === "complaints" || presetSlug === "sales-compliance") {
        return `Hi ${name},\n\nMost lenders we talk to are only catching complaints that agents manually flag — which is maybe 30% of actual dissatisfaction. The rest compounds silently.\n\nWe built Rulebase to catch 100% automatically. Relevant for ${companyName}?`;
      }
      return `Hi ${name},\n\nMost CX teams review 1-3% of conversations. Rulebase evaluates 100% automatically and surfaces the patterns manual QA misses.\n\nRelevant for ${companyName}?`;
    }

    function makeLinkedIn(firstName: string): string {
      const name = firstName || "there";
      if (hasRegulatory)
        return `Hi ${name} — saw the CFPB activity around ${companyName}. We help lenders catch the complaints that lead to enforcement before they compound. Thought it might be timely.`;
      if (hasTrustpilot)
        return `Hi ${name} — noticed ${companyName}'s reviews. We help catch the 70% of complaints agents miss. Would love to connect.`;
      if (hasNewLeader)
        return `Hi ${name} — congrats on the new role at ${companyName}. Most leaders discover QA covers 1-3% of conversations. We fix that from day one. Worth connecting?`;
      if (hasPE)
        return `Hi ${name} — saw the ownership change at ${companyName}. New owners usually want compliance risk quantified. We make that visible. Worth connecting?`;
      if (hasUDAAP)
        return `Hi ${name} — ${companyName} has the kind of sales operation examiners focus on. We make sure every call is clean. Worth connecting?`;
      if (hasAI)
        return `Hi ${name} — saw ${companyName} is deploying AI for CX. We solve the QA gap for AI conversations. Would love to connect.`;
      if (hasHiring)
        return `Hi ${name} — noticed ${companyName} is scaling CX/compliance. We help teams maintain quality at scale. Would love to connect.`;
      return `Hi ${name} — ${companyName} came up in our research. We help teams monitor 100% of conversations. Would love to connect.`;
    }

    function makeCreative(firstName: string): string {
      const who = firstName || "the CCO";
      // Route by top signal
      if (hasRegulatory)
        return `Send a "Compliance Survival Kit" to ${who} at ${companyName} HQ — box with a branded stress ball, one-pager "The 70% Problem: What Your Agents Aren't Logging," QR to a 3-min Loom demo. Handwritten note: "Thought this might be useful given what's been happening. — Gideon"`;
      if (hasTrustpilot)
        return `Print ${companyName}'s top 5 worst Trustpilot reviews on cards. Back of each: "Rulebase would have caught this before it went public." Mail to ${who} with sticky note: "These are just the ones who bothered to post. — Gideon" + Calendly link.`;
      if (hasNewLeader)
        return `Send a "New Leader Starter Pack" to ${who} at ${companyName} — branded notebook + one-pager: "5 Questions Every New CCO / CX Leader Asks in Week 1." QR to Calendly. Note: "For the audit you're probably already running. — Gideon"`;
      if (hasPE)
        return `Send a "Due Diligence Kit" — folder with: "Compliance Risk Scorecard for Lenders Post-Acquisition" one-pager + sample Rulebase audit report. FedEx to ${who} at ${companyName}. Note: "For the conversation you're probably already having. — Gideon"`;
      if (hasUDAAP)
        return `Create a "CFPB Exam Prep Box" — branded folder: (1) top 5 UDAAP violations this year, (2) mock exam checklist. FedEx to ${who} at ${companyName}. Note: "For when the examiner calls. — Gideon"`;
      if (hasAI)
        return `Send a "Robot Report Card" to ${who} at ${companyName} — novelty report card grading their AI agent: Communication A-, Accuracy ?, Compliance ?, Empathy C+. Inside: "Who's grading them? — Gideon @ Rulebase" + Calendly.`;
      if (hasHiring)
        return `Send a jar of 100 jelly beans to ${who} at ${companyName}. 97 white, 3 red. Label: "You're reviewing 3 out of 100 conversations." Card: "Rulebase reviews all 100. — Gideon" + Calendly.`;
      return `Mail a magnifying glass to ${who} at ${companyName}. Tag: "You're using this to review 3% of conversations. We review 100% without it." — Gideon @ Rulebase + QR to Calendly.`;
    }

    if (contacts.length > 0) {
      for (const cr of contacts) {
        const person = cr.person as Record<string, unknown>;
        const contactName = (person.name as string) ?? "";
        const title = (person.title as string) ?? "";
        const email =
          (person.work_email as string) ??
          (person.personal_email as string) ??
          "";
        const linkedin = (person.linkedin_url as string) ?? "";
        const firstName = contactName.split(" ")[0] ?? "";

        csvRows.push(
          [
            esc(companyName),
            esc(String(row.relevance_score ?? "")),
            esc(signal),
            esc(contactName),
            esc(title),
            esc(email),
            esc(linkedin),
            esc(`1. LinkedIn connect ${firstName} → 2. Message → 3. Call`),
            esc(makeEmail(firstName)),
            esc(makeLinkedIn(firstName)),
            esc(makeCreative(firstName)),
          ].join(","),
        );
      }
    } else {
      csvRows.push(
        [
          esc(companyName),
          esc(String(row.relevance_score ?? "")),
          esc(signal),
          esc(""),
          esc(""),
          esc(""),
          esc(""),
          esc("Find CCO / Head of CX on LinkedIn → connect → message → call"),
          esc(makeEmail("")),
          esc(makeLinkedIn("")),
          esc(makeCreative("")),
        ].join(","),
      );
    }
  }

  const csv = [header, ...csvRows].join("\n");
  const filename = preset
    ? `rulebase-${preset}-${new Date().toISOString().slice(0, 10)}.csv`
    : `rulebase-export-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
