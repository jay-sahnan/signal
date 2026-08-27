import { describe, it, expect, vi, beforeEach } from "vitest";

import { createSupabaseFake } from "./helpers/supabase-fake";

/**
 * The affiliation half of contact discovery: who gets attached to a company,
 * who gets kept but flagged, and who gets detached.
 *
 * The two failure modes this guards against are opposites, and the codebase has
 * shipped both. A hard headline filter deletes real employees (measured: it
 * would have discarded 22 of 41 genuine contacts at one company). No filter at
 * all files strangers under the company — which is how a Wafer employee ended
 * up stored as working at Browserbase.
 */

const judged = vi.fn();
const { domainPeople } = vi.hoisted(() => ({
  domainPeople: vi.fn().mockResolvedValue([] as unknown[]),
}));
vi.mock("@/lib/services/contact-filter", () => ({
  filterContactsByCompany: (...args: unknown[]) => judged(...args),
  findPeopleOnDomain: domainPeople,
}));

const exaResults = {
  results: [] as Array<{
    url: string;
    title: string;
    text?: string | null;
    publishedDate?: string | null;
  }>,
};
vi.mock("@/lib/services/exa-service", () => ({
  ExaService: class {
    async search() {
      return exaResults;
    }
  },
}));

const created: Array<Record<string, unknown>> = [];
vi.mock("@/lib/services/knowledge-base", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/knowledge-base")>();
  return {
    ...actual,
    findOrCreatePerson: vi.fn(async (data: Record<string, unknown>) => {
      created.push(data);
      return {
        id: `p${created.length}`,
        name: data.name,
        title: data.title ?? null,
        work_email: null,
        personal_email: null,
        linkedin_url: data.linkedin_url ?? null,
      };
    }),
    linkPersonToCampaign: vi.fn().mockResolvedValue({ id: "cp1" }),
  };
});

const affiliations: Array<Record<string, unknown>> = [];
/**
 * What recordAffiliation reports back. It is monotonic on the source weight, so
 * refusing a write is a normal outcome, not an error, and the storage loop has
 * to read it rather than assume the verdict landed.
 */
const writeResult: {
  current: {
    written: boolean;
    reason?: string;
    notAtJudgedOrg?: boolean;
    attachedElsewhere?: boolean;
  };
} = {
  current: { written: true },
};
vi.mock("@/lib/services/affiliation", () => ({
  recordAffiliation: vi.fn(async (_c: unknown, a: Record<string, unknown>) => {
    affiliations.push(a);
    return writeResult.current;
  }),
}));

vi.mock("@/lib/services/email-pattern", () => ({
  recordVerifiedEmail: vi.fn().mockResolvedValue(undefined),
}));

import {
  findContactsForOrganization,
  MAX_ALREADY_LINKED,
} from "@/lib/services/contact-discovery";
import { linkPersonToCampaign } from "@/lib/services/knowledge-base";

/** The organization under test. */
let org: Record<string, unknown> = {};
/** People already attached to `org`. */
let orgPeople: Array<Record<string, unknown>> = [];

/**
 * A second company, and someone who works at it.
 *
 * Both queries in this path are scoped: the org read by `.eq("id", ...)` and the
 * roster by `.eq("organization_id", ...)`. With one organization and one set of
 * people in the fixtures, deleting either predicate changed nothing and the
 * whole suite stayed green. These rows are what make an unscoped query return
 * the wrong answer instead of the same one.
 */
const OTHER_ORG = {
  id: "org-2",
  name: "Chronicle Labs",
  domain: "chroniclelabs.com",
  industry: "developer tools",
  location: "NYC",
  description: null,
};

const otherOrgPerson = {
  id: "elsewhere-1",
  name: "Stranger S",
  title: "Engineer",
  work_email: null,
  personal_email: null,
  linkedin_url: "https://www.linkedin.com/in/stranger",
  organization_id: OTHER_ORG.id,
};

/** Per-table read failures, for the dedup-set fail-closed tests. */
let readErrors: Record<string, { message: string } | undefined> = {};

const client = () =>
  createSupabaseFake({
    tables: {
      organizations: () => [org, OTHER_ORG],
      people: () => [...orgPeople, otherOrgPerson],
      // Only read when a campaignId is passed, which most tests do not do.
      campaign_people: () => [],
    },
    relations: { campaign_people: { person: { localKey: "person_id" } } },
    selectError: (table) => readErrors[table] ?? null,
  });

beforeEach(() => {
  created.length = 0;
  affiliations.length = 0;
  writeResult.current = { written: true };
  exaResults.results = [];
  orgPeople = [];
  readErrors = {};
  judged.mockReset().mockResolvedValue([]);
  domainPeople.mockReset().mockResolvedValue([]);
  org = {
    id: "org-1",
    name: "Browserbase",
    domain: "browserbase.com",
    industry: "developer tools",
    location: "SF",
    description: null,
  };
});

const run = () =>
  findContactsForOrganization(client(), {
    organizationId: "org-1",
    campaignId: null,
    titles: ["engineer"],
    numResults: 3,
  });

describe("domain gate", () => {
  it("refuses to attach people to a company with no domain", async () => {
    // Two different companies called "Acme" are indistinguishable without one,
    // so attaching contacts is how their people get pooled.
    org = { ...org, domain: null };

    const result = await run();

    expect(result.error).toContain("no domain");
    expect(result.contacts).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  it("says what would unblock it rather than failing silently", async () => {
    org = { ...org, domain: null };

    const result = await run();

    expect(result.error).toMatch(/resolve the company's website/i);
  });
});

describe("titles", () => {
  it("leaves the title blank when the headline does not name one", async () => {
    // The title we searched for is not evidence about the person we found.
    // Falling back to it stamped the ICP target title onto anyone whose
    // headline didn't parse, which is how a 15-person startup ended up
    // showing three Heads of Growth and four Revenue Operations.
    exaResults.results = [
      { url: "https://www.linkedin.com/in/c", title: "Cal C" },
    ];

    await run();

    const candidates = judged.mock.calls[0][1] as Array<{
      name: string;
      title: string | null;
      searchTitle: string;
    }>;
    expect(candidates[0].name).toBe("Cal C");
    expect(candidates[0].title).toBeNull();
    // Still available as query context — just never mistaken for their role.
    expect(candidates[0].searchTitle).toBe("engineer");
  });

  it("keeps a title it actually read off the headline", async () => {
    exaResults.results = [
      {
        url: "https://www.linkedin.com/in/a",
        title: "Ann A - Staff Engineer at Browserbase",
      },
    ];

    await run();

    const candidates = judged.mock.calls[0][1] as Array<{
      title: string | null;
    }>;
    expect(candidates[0].title).toBe("Staff Engineer at Browserbase");
  });
});

describe("alreadyLinked", () => {
  const person = (i: number) => ({
    id: `ex${i}`,
    name: `Existing ${i}`,
    title: "Engineer",
    work_email: null,
    personal_email: null,
    linkedin_url: `https://www.linkedin.com/in/ex${i}`,
    organization_id: "org-1",
  });

  it("returns people already attached to the org", async () => {
    orgPeople = [person(1), person(2)];

    const result = await run();

    // Two, not three: someone at another company is in the table and must not
    // be rostered here. The roster is what the agent reads back as "everyone at
    // this company", so an unscoped query pools unrelated businesses.
    expect(result.alreadyLinkedTotal).toBe(2);
    expect(result.alreadyLinked.map((p) => p.name)).toEqual([
      "Existing 1",
      "Existing 2",
    ]);
  });

  it("caps the roster but still reports the true total", async () => {
    // A truncated list that reports its own length reads as complete, which is
    // how "that's everyone at this company" becomes a silent lie.
    orgPeople = Array.from({ length: MAX_ALREADY_LINKED + 20 }, (_, i) =>
      person(i),
    );

    const result = await run();

    expect(result.alreadyLinked).toHaveLength(MAX_ALREADY_LINKED);
    expect(result.alreadyLinkedTotal).toBe(MAX_ALREADY_LINKED + 20);
  });

  it("dedups against every known person, not just the capped ones", async () => {
    // Capping dedup would re-fetch and re-bill people we already hold.
    orgPeople = Array.from({ length: MAX_ALREADY_LINKED + 1 }, (_, i) =>
      person(i),
    );
    // The last person is past the display cap; a search hit for them must
    // still be recognised as a duplicate.
    exaResults.results = [
      {
        url: `https://www.linkedin.com/in/ex${MAX_ALREADY_LINKED}`,
        title: "Existing 50 - Browserbase",
      },
    ];

    const result = await run();

    expect(result.duplicatesSkipped).toBe(1);
    expect(judged).not.toHaveBeenCalled();
  });
});

describe("verdict handling", () => {
  beforeEach(() => {
    exaResults.results = [
      { url: "https://www.linkedin.com/in/a", title: "Ann A - Browserbase" },
      { url: "https://www.linkedin.com/in/b", title: "Bob B - Wafer" },
      { url: "https://www.linkedin.com/in/c", title: "Cal C" },
    ];
  });

  it("attaches verified people and records why", async () => {
    judged.mockResolvedValue([
      {
        index: 0,
        name: "Ann A",
        title: "Engineer",
        verdict: "verified",
        evidence: "headline names Browserbase",
      },
    ]);

    const result = await run();

    expect(result.verifiedCount).toBe(1);
    expect(created[0].organization_id).toBe("org-1");
    expect(affiliations[0]).toMatchObject({
      organizationId: "org-1",
      source: "llm_verified",
      evidence: "headline names Browserbase",
    });
  });

  it("detaches someone the evidence places at another company", async () => {
    // The Garrett Graves case: returned by a search for "Browserbase", but the
    // profile says Wafer. Kept as a person, not filed under this company.
    judged.mockResolvedValue([
      {
        index: 1,
        name: "Bob B",
        title: "Engineer",
        verdict: "rejected",
        evidence: "headline reads 'Wafer'",
      },
    ]);

    const result = await run();

    expect(result.rejectedAsWrongCompany).toBe(1);
    expect(result.contacts).toHaveLength(0);
    expect(created[0].organization_id).toBeNull();
    expect(affiliations[0].organizationId).toBeNull();
  });

  it("keeps unproven people, attached but weakly", async () => {
    // The 19-of-41 case: no employer in the headline is not evidence of
    // anything. Dropping them is what made the old hard filter unusable.
    judged.mockResolvedValue([
      {
        index: 2,
        name: "Cal C",
        title: "Engineer",
        verdict: "uncertain",
        evidence: "headline names no employer",
      },
    ]);

    const result = await run();

    expect(result.uncertainCount).toBe(1);
    expect(result.contacts).toHaveLength(1);
    expect(created[0].organization_id).toBe("org-1");
    // Weakest source, so the send gate refuses them until something confirms.
    expect(affiliations[0].source).toBe("search_stamp");
  });

  it("reports the real counts, not a hardcoded zero", async () => {
    judged.mockResolvedValue([
      {
        index: 0,
        name: "Ann A",
        title: null,
        verdict: "verified",
        evidence: "x",
      },
      {
        index: 1,
        name: "Bob B",
        title: null,
        verdict: "rejected",
        evidence: "y",
      },
      {
        index: 2,
        name: "Cal C",
        title: null,
        verdict: "uncertain",
        evidence: "z",
      },
    ]);

    const result = await run();

    expect(result).toMatchObject({
      verifiedCount: 1,
      rejectedAsWrongCompany: 1,
      uncertainCount: 1,
    });
  });
});

describe("evidence handed to the judge", () => {
  it("passes the page text and date Exa returned", async () => {
    // includeText is already set on the search, so this text is paid for
    // whether or not we read it. Dropping it is why every candidate at a
    // company whose staff do not name their employer came back uncertain.
    exaResults.results = [
      {
        url: "https://www.linkedin.com/in/a",
        title: "Ann A - Engineer",
        text: "Experience: Software Engineer, Browserbase, May 2025 - Present",
        publishedDate: "2026-07-23",
      },
    ];

    await run();

    const candidates = judged.mock.calls[0][1] as Array<{
      pageText: string | null;
      pageDate: string | null;
    }>;
    expect(candidates[0].pageText).toContain("May 2025 - Present");
    expect(candidates[0].pageDate).toBe("2026-07-23");
  });
});

describe("acting on the verdicts", () => {
  const oneCandidate = () => {
    exaResults.results = [
      { url: "https://www.linkedin.com/in/a", title: "Ann A - Engineer" },
    ];
  };

  it("detaches someone the evidence says has left", async () => {
    oneCandidate();
    judged.mockResolvedValue([
      {
        index: 0,
        name: "Ann A",
        title: "Engineer",
        verdict: "former_employee",
        employerSeen: "Browserbase",
        datesSeen: "Oct 2024 - Mar 2026",
        evidence: "role ended Mar 2026",
      },
    ]);

    const result = await run();

    const last = affiliations[affiliations.length - 1];
    expect(last.source).toBe("former_employee");
    expect(last.organizationId).toBeNull();
    expect(result.departedCount).toBe(1);
    // Reporting them as a contact at this company one line after detaching
    // them is how a caller ends up drafting for someone who left.
    expect(result.contacts).toHaveLength(0);
  });

  it("detaches someone the evidence places elsewhere", async () => {
    oneCandidate();
    judged.mockResolvedValue([
      {
        index: 0,
        name: "Ann A",
        title: "Engineer",
        verdict: "rejected",
        employerSeen: "Chronicle Labs",
        datesSeen: "May 2024 - Present",
        evidence: "profile names Chronicle Labs",
      },
    ]);

    const result = await run();

    const last = affiliations[affiliations.length - 1];
    expect(last.source).toBe("employer_mismatch");
    expect(last.organizationId).toBeNull();
    expect(last.evidence).toContain("Chronicle Labs");
    // The verdict is about THIS company. Without saying which, the write means
    // "detach from wherever you are", so a correct rejection here detaches the
    // person from the unrelated company they really do work at.
    expect(last.detachedFrom).toBe("org-1");
    expect(result.rejectedAsWrongCompany).toBe(1);
  });

  it("scopes a departure to the company that was judged", async () => {
    oneCandidate();
    judged.mockResolvedValue([
      {
        index: 0,
        name: "Ann A",
        title: "Engineer",
        verdict: "former_employee",
        evidence: "role ended Mar 2026",
      },
    ]);

    await run();

    expect(affiliations[affiliations.length - 1].detachedFrom).toBe("org-1");
  });

  it("still keeps uncertain people attached and flagged", async () => {
    // The whole point of `uncertain` is that we keep them. This must not
    // regress into the old hard filter that deleted real employees.
    oneCandidate();
    judged.mockResolvedValue([
      {
        index: 0,
        name: "Ann A",
        title: "Engineer",
        verdict: "uncertain",
        evidence: "page text unavailable",
      },
    ]);

    const result = await run();

    expect(result.contacts).toHaveLength(1);
    expect(result.uncertainCount).toBe(1);
    expect(affiliations[affiliations.length - 1].source).toBe("search_stamp");
  });
});

describe("when the write is refused", () => {
  const oneCandidate = () => {
    exaResults.results = [
      { url: "https://www.linkedin.com/in/a", title: "Ann A - Engineer" },
    ];
  };

  beforeEach(() => {
    writeResult.current = { written: false, reason: "weaker_than_existing" };
  });

  it("does not report a verified contact the write refused", async () => {
    // A person already on file at team_page (0.9): the judge says verified
    // (0.6) and recordAffiliation correctly refuses. Counting the verdict
    // anyway is how "8 verified contacts" gets reported for rows the send gate
    // then blocks.
    oneCandidate();
    judged.mockResolvedValue([
      {
        index: 0,
        name: "Ann A",
        title: "Engineer",
        verdict: "verified",
        evidence: "headline names Browserbase",
      },
    ]);

    const result = await run();

    expect(result.verifiedCount).toBe(0);
    expect(result.affiliationUnchanged).toBe(1);
  });

  it("does not drop someone whose detach was refused", async () => {
    // The inverse failure: the write is refused, so they are still attached and
    // still sendable, but they were reported as departed and dropped from the
    // list the caller works from.
    oneCandidate();
    judged.mockResolvedValue([
      {
        index: 0,
        name: "Ann A",
        title: "Engineer",
        verdict: "former_employee",
        evidence: "role ended Mar 2026",
      },
    ]);

    const result = await run();

    expect(result.departedCount).toBe(0);
    expect(result.affiliationUnchanged).toBe(1);
    expect(result.contacts).toHaveLength(1);
    // Labelled for what actually happened, not for what the judge wanted.
    expect(result.contacts[0].affiliation).toBe("unchanged");
  });

  it("does not report a rejection the write refused", async () => {
    oneCandidate();
    judged.mockResolvedValue([
      {
        index: 0,
        name: "Ann A",
        title: "Engineer",
        verdict: "rejected",
        evidence: "profile names Chronicle Labs",
      },
    ]);

    const result = await run();

    expect(result.rejectedAsWrongCompany).toBe(0);
    expect(result.affiliationUnchanged).toBe(1);
    expect(result.contacts).toHaveLength(1);
  });

  it("does not list a stranger as a contact here when the detach did not apply", async () => {
    // The other refusal, and it means the opposite thing. "You are not at the
    // company that was judged" leaves the row untouched AND leaves the person
    // filed under someone else, so putting them in this company's contact list
    // as "unchanged" is the same lie in a quieter voice.
    writeResult.current = {
      written: false,
      reason: "not_attached_to_judged_org",
      notAtJudgedOrg: true,
    };
    oneCandidate();
    judged.mockResolvedValue([
      {
        index: 0,
        name: "Ann A",
        title: "Engineer",
        verdict: "rejected",
        employerSeen: "Box",
        evidence: "profile names Box",
      },
    ]);

    const result = await run();

    expect(result.contacts).toHaveLength(0);
    expect(result.affiliationUnchanged).toBe(0);
    expect(result.rejectedAsWrongCompany).toBe(1);
  });

  it("counts a refused team page write as unchanged, not verified", async () => {
    // Phase 1 has the same bug: verifiedCount++ regardless of the write.
    const { findPeopleOnDomain } =
      await import("@/lib/services/contact-filter");
    vi.mocked(findPeopleOnDomain).mockResolvedValueOnce([
      {
        name: "Dee D",
        title: "Engineer",
        linkedinUrl: "https://www.linkedin.com/in/dee",
        email: null,
      },
    ]);

    const result = await run();

    expect(result.verifiedCount).toBe(0);
    expect(result.affiliationUnchanged).toBe(1);
    expect(result.contacts).toHaveLength(1);
  });
});

describe("when the dedup roster cannot be read", () => {
  it("fails closed instead of re-billing every known contact", async () => {
    // `data ?? []` on a failed query yields an empty dedup set, so every
    // already-attached contact fails the duplicate checks, is re-fetched from
    // Exa and re-judged by the LLM, then reported as newly added.
    readErrors = { people: { message: "connection reset by peer" } };

    const result = await run();

    expect(result.error).toContain("connection reset");
    expect(result.contacts).toHaveLength(0);
    expect(judged).not.toHaveBeenCalled();
  });

  it("fails closed when the campaign links cannot be read", async () => {
    readErrors = { campaign_people: { message: "permission denied" } };

    const result = await findContactsForOrganization(client(), {
      organizationId: "org-1",
      campaignId: "camp-1",
      titles: ["engineer"],
      numResults: 3,
    });

    expect(result.error).toContain("permission denied");
    expect(judged).not.toHaveBeenCalled();
  });
});

describe("someone filed elsewhere with stronger evidence", () => {
  const oneCandidate = () => {
    exaResults.results = [
      { url: "https://www.linkedin.com/in/a", title: "Ann A - Engineer" },
    ];
  };

  beforeEach(() => {
    writeResult.current = {
      written: false,
      reason: "not_stronger_than_existing",
      attachedElsewhere: true,
    };
  });

  it("is not listed or campaign-linked off a search verdict", async () => {
    // The judge said verified, but the row is filed under a different company
    // whose evidence outranks this search. They are not a contact here, and
    // campaign-linking them anyway is how strangers end up in a send list.
    oneCandidate();
    judged.mockResolvedValue([
      {
        index: 0,
        name: "Ann A",
        title: "Engineer",
        verdict: "verified",
        evidence: "headline names Browserbase",
      },
    ]);

    const { linkPersonToCampaign } =
      await import("@/lib/services/knowledge-base");
    const result = await findContactsForOrganization(client(), {
      organizationId: "org-1",
      campaignId: "camp-1",
      titles: ["engineer"],
      numResults: 3,
    });

    expect(result.contacts).toHaveLength(0);
    expect(result.verifiedCount).toBe(0);
    expect(result.affiliationUnchanged).toBe(0);
    expect(result.rejectedAsWrongCompany).toBe(1);
    expect(vi.mocked(linkPersonToCampaign)).not.toHaveBeenCalled();
  });

  it("is not listed or campaign-linked off a team-page listing", async () => {
    // Phase 1 has the same hole: the campaign link ran unconditionally,
    // before the write result was even read.
    const { findPeopleOnDomain } =
      await import("@/lib/services/contact-filter");
    vi.mocked(findPeopleOnDomain).mockResolvedValueOnce([
      {
        name: "Dee D",
        title: "Engineer",
        linkedinUrl: "https://www.linkedin.com/in/dee",
        email: null,
      },
    ]);
    const { linkPersonToCampaign } =
      await import("@/lib/services/knowledge-base");

    const result = await findContactsForOrganization(client(), {
      organizationId: "org-1",
      campaignId: "camp-1",
      titles: [],
      numResults: 3,
    });

    expect(result.contacts).toHaveLength(0);
    expect(result.verifiedCount).toBe(0);
    expect(result.affiliationUnchanged).toBe(0);
    expect(result.rejectedAsWrongCompany).toBe(1);
    expect(vi.mocked(linkPersonToCampaign)).not.toHaveBeenCalled();
  });
});

// ─── The team page lists everyone; the campaign asked for some roles ──────

describe("team-page linking", () => {
  const teamPage = [
    {
      name: "Gina Growth",
      title: "Growth Lead",
      linkedinUrl: null,
      email: null,
    },
    { name: "Fred Finance", title: "CFO", linkedinUrl: null, email: null },
    { name: "Nora Notitle", title: null, linkedinUrl: null, email: null },
  ];
  const runWithCampaign = (linkTeamPage?: "matching" | "all") =>
    findContactsForOrganization(client(), {
      organizationId: "org-1",
      campaignId: "camp-1",
      titles: ["Head of Growth"],
      numResults: 3,
      linkTeamPage,
    });

  it("stores everyone but links only the target role family by default", async () => {
    domainPeople.mockResolvedValue(teamPage);
    const link = vi.mocked(linkPersonToCampaign);
    link.mockClear();
    const result = await runWithCampaign();
    expect(created.map((c) => c.name)).toEqual([
      "Gina Growth",
      "Fred Finance",
      "Nora Notitle",
    ]);
    expect(affiliations).toHaveLength(3);
    expect(link).toHaveBeenCalledTimes(1);
    expect(result.contacts.map((c) => c.name)).toEqual(["Gina Growth"]);
    expect(result.teamPageUnlinked).toBe(2);
    expect(result.verifiedCount).toBe(1);
  });

  it("links every listed employee when asked for all", async () => {
    domainPeople.mockResolvedValue(teamPage);
    const link = vi.mocked(linkPersonToCampaign);
    link.mockClear();
    const result = await runWithCampaign("all");
    expect(link).toHaveBeenCalledTimes(3);
    expect(result.teamPageUnlinked).toBe(0);
    expect(result.contacts).toHaveLength(3);
  });
});
