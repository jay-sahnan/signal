import { describe, expect, it } from "vitest";
import {
  buildComposeUserPrompt,
  buildEmailSystemPrompt,
} from "@/lib/email-composition/skill";
import { renderFactBank } from "@/lib/sender-facts";

const baseInput = {
  contact: { name: "A", title: null, email: "a@b.co", enrichmentData: null },
  company: null,
  step: { stepNumber: 1, totalSteps: 1, condition: "always", isFinal: false },
  campaign: { name: "C", icp: null, offering: null, positioning: null },
  senderProfile: {
    name: "Jay",
    title: "Founder",
    company: "Signal",
    offeringSummary: "AI sales agent",
    notes: "prefers plain speech",
  },
};

describe("buildEmailSystemPrompt with a fact bank", () => {
  const bank = renderFactBank([
    { id: "1", category: "proof_point", fact: "200 customers", source: "user" },
  ])!;

  it("appends the fact bank after the voice profile", () => {
    const sys = buildEmailSystemPrompt(null, bank);
    expect(sys).toContain("SENDER FACT BANK");
    expect(sys).toContain("200 customers");
  });

  it("is byte-identical to today when there is no bank", () => {
    expect(buildEmailSystemPrompt(null, null)).toBe(
      buildEmailSystemPrompt(null),
    );
  });

  it("holds the identity with a voice profile present too", () => {
    const voice = {
      id: "v1",
      user_id: "u1",
      campaign_id: null,
      instructions: "Open on the signal, no greeting line.",
      summary: null,
      source_transcript: null,
      created_at: "",
      updated_at: "",
    };
    expect(buildEmailSystemPrompt(voice, null)).toBe(
      buildEmailSystemPrompt(voice),
    );
    const withBank = buildEmailSystemPrompt(voice, bank);
    expect(withBank).toContain("Open on the signal");
    // The bank lands after the voice block, never inside or before it.
    expect(withBank.indexOf("SENDER FACT BANK")).toBeGreaterThan(
      withBank.indexOf("Open on the signal"),
    );
  });
});

describe("buildComposeUserPrompt breakup framing", () => {
  it("never frames step 1 as a breakup, even when the caller flags it final", () => {
    // Regression: 1-step sequences (and regenerate's ad-hoc default) passed
    // isFinal for step 1 of 1, so the model was told "FINAL: breakup email"
    // and invented a prior thread ("nothing back from my last note") for
    // contacts who had never been emailed.
    const prompt = buildComposeUserPrompt({
      ...baseInput,
      step: {
        stepNumber: 1,
        totalSteps: 1,
        condition: "always",
        isFinal: true,
      },
    });
    expect(prompt).toContain("STEP 1 of 1");
    expect(prompt).not.toContain("breakup");
  });

  it("keeps breakup framing for the last of several steps", () => {
    const prompt = buildComposeUserPrompt({
      ...baseInput,
      step: {
        stepNumber: 3,
        totalSteps: 3,
        condition: "no_reply",
        isFinal: true,
      },
    });
    expect(prompt).toContain("STEP 3 of 3 (FINAL: breakup email)");
  });
});

describe("email skill system prompt", () => {
  it("forbids implying prior emails without a previous subject in context", () => {
    const sys = buildEmailSystemPrompt(null, null);
    expect(sys).toContain("unless PREVIOUS EMAIL SUBJECT appears");
  });
});

describe("buildComposeUserPrompt sender fields", () => {
  it("carries offering summary and notes that were previously dropped", () => {
    const prompt = buildComposeUserPrompt(baseInput);
    expect(prompt).toContain("AI sales agent");
    expect(prompt).toContain("prefers plain speech");
  });

  it("omits the lines when unset instead of printing placeholders", () => {
    const prompt = buildComposeUserPrompt({
      ...baseInput,
      senderProfile: {
        ...baseInput.senderProfile,
        offeringSummary: null,
        notes: null,
      },
    });
    expect(prompt).not.toContain("Offering summary");
    expect(prompt).not.toContain("Sender notes");
  });
});

describe("buildComposeUserPrompt meeting link", () => {
  it("renders the booking URL as its own SENDER line when set", () => {
    const prompt = buildComposeUserPrompt({
      ...baseInput,
      senderProfile: {
        ...baseInput.senderProfile,
        bookingUrl: "https://cal.com/jay/15min",
      },
    });
    expect(prompt).toContain("Meeting link");
    expect(prompt).toContain("https://cal.com/jay/15min");
  });

  // The system rule says "if SENDER lists a meeting link"; an empty or
  // whitespace value must not render a line the model could read as one.
  it("omits the line when the URL is unset or blank", () => {
    for (const bookingUrl of [undefined, null, "", "   "]) {
      const prompt = buildComposeUserPrompt({
        ...baseInput,
        senderProfile: { ...baseInput.senderProfile, bookingUrl },
      });
      expect(prompt).not.toContain("Meeting link");
    }
  });
});
