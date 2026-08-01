import { describe, it, expect } from "vitest";

import {
  canSendTo,
  AFFILIATION_WEIGHT,
  type SendCandidate,
} from "@/lib/services/affiliation";

/**
 * Nothing checked any of this before: the send path asked only whether the
 * address field was non-empty, so a blind {first}.{last}@domain guess written
 * at confidence 0.2 was treated exactly like an address the user typed in.
 *
 * The two halves fail differently and both matter — a bad address bounces and
 * costs sender reputation, a bad affiliation sends a personalised pitch about
 * the wrong company to a real person.
 */

const base: SendCandidate = {
  work_email: "jane.doe@acme.com",
  work_email_source: "pattern_derived",
  work_email_verification: "deliverable",
  affiliation_confidence: AFFILIATION_WEIGHT.team_page,
  affiliation_source: "team_page",
};

const p = (over: Partial<SendCandidate> = {}): SendCandidate => ({
  ...base,
  ...over,
});

describe("canSendTo", () => {
  it("allows a verified address at a confirmed employer", () => {
    expect(canSendTo(p())).toEqual({ ok: true });
  });

  it("blocks a contact with no address", () => {
    const result = canSendTo(p({ work_email: null }));
    expect(result.ok).toBe(false);
  });

  it("blocks an unverified pattern guess", () => {
    // The exact row the old code would have emailed.
    const result = canSendTo(
      p({
        work_email_verification: "unchecked",
        work_email_source: "pattern_derived",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/never been verified/i);
  });

  it("blocks a catch-all address", () => {
    const result = canSendTo(p({ work_email_verification: "risky" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("risky");
  });

  it("trusts an address the user typed, without a verifier", () => {
    // A human is better evidence than any API, and self-hosted instances may
    // have no provider configured at all.
    expect(
      canSendTo(
        p({
          work_email_source: "user_entered",
          work_email_verification: "unchecked",
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("trusts an address a previous send was accepted for", () => {
    expect(
      canSendTo(
        p({
          work_email_source: "send_confirmed",
          work_email_verification: "unchecked",
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("allows an imported contact once its address verifies — csv_import clears the threshold", () => {
    // The whole point of ranking csv_import at 0.85: an uploaded contact is
    // draftable and sendable as-is, without waiting for further enrichment.
    const result = canSendTo(
      p({
        work_email_source: "csv_import",
        work_email_verification: "deliverable",
        affiliation_source: "csv_import",
        affiliation_confidence: AFFILIATION_WEIGHT.csv_import,
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("does not trust an imported address without verification", () => {
    // csv_import is deliberately absent from the trusted-source shortcuts:
    // the just-in-time verifier must still prove an uploaded mailbox.
    const result = canSendTo(
      p({
        work_email_source: "csv_import",
        work_email_verification: "unchecked",
        affiliation_source: "csv_import",
        affiliation_confidence: AFFILIATION_WEIGHT.csv_import,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/never been verified/i);
  });

  it("blocks a verified address at an unconfirmed employer", () => {
    // A real mailbox is not permission to pitch them about a company they may
    // not work for.
    const result = canSendTo(
      p({
        affiliation_source: "search_stamp",
        affiliation_confidence: AFFILIATION_WEIGHT.search_stamp,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not confirmed to work/i);
  });

  it("blocks legacy rows that carry no affiliation evidence at all", () => {
    const result = canSendTo(
      p({ affiliation_source: null, affiliation_confidence: null }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no evidence/i);
  });

  it("allows an LLM-verified affiliation — exactly at the threshold", () => {
    expect(
      canSendTo(
        p({
          affiliation_source: "llm_verified",
          affiliation_confidence: AFFILIATION_WEIGHT.llm_verified,
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("blocks a bounced address even though a send once confirmed it", () => {
    // recordBounce marks the address undeliverable. Without that, canSendTo
    // trusts send_confirmed — which every sent address carries by definition —
    // so a hard-bounced mailbox stayed sendable for the next campaign.
    const result = canSendTo(
      p({
        work_email_source: "send_confirmed",
        work_email_verification: "undeliverable",
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("blocks a user-entered address that hard-bounced", () => {
    // The exception-flag cross-product that survived three review rounds
    // untested: user_entered bypasses `risky` (catch-all noise a human can
    // vouch past), but a bounce is recorded about the exact string the human
    // typed — a typo. Nothing displaces user_entered (1.0), so exempting it
    // here made the typo permanently sendable.
    const result = canSendTo(
      p({
        work_email_source: "user_entered",
        work_email_verification: "undeliverable",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/hard-bounced/i);
  });

  it("lets a user-entered address through a catch-all risky verdict", () => {
    // The narrow exemption that IS intended: on a catch-all domain every
    // address verifies risky, so without this nothing at such a company could
    // ever be emailed. A human vouching is the one signal a catch-all can't fake.
    expect(
      canSendTo(
        p({
          work_email_source: "user_entered",
          work_email_verification: "risky",
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("names the personal-only situation instead of claiming no address exists", () => {
    const result = canSendTo(
      p({ work_email: null, personal_email: "jane@gmail.com" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/personal address/i);
  });

  it("always explains the blockage rather than failing silently", () => {
    for (const person of [
      p({ work_email: null }),
      p({ work_email_verification: "unchecked" }),
      p({ affiliation_confidence: 0, affiliation_source: null }),
    ]) {
      const result = canSendTo(person);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason.length).toBeGreaterThan(10);
    }
  });
});
