import { z } from "zod";

import { UNTRUSTED_NOTICE, wrapUntrusted } from "@/lib/prompt-safety";
import type { RealRecipient } from "@/lib/email-skills/swipe-recipient";

/**
 * The two prompts behind voice-by-swiping.
 *
 * The user judges drafts instead of answering questions, and types instructions
 * in plain English as they go. Both signals are natural language or become it,
 * so the model does the interpreting — the earlier attempt parsed instructions
 * with regexes and deleted the very thing the user had asked to keep ("I like
 * blunt but not too formal" removed the blunt drafts, because a negation
 * appeared somewhere in the sentence).
 *
 * Nothing here mutates draft text. Instructions are carried in the transcript
 * and honoured by the next generation, which is the only way an instruction
 * like "warmer" can be satisfied at all.
 */

// ── Shared shapes ───────────────────────────────────────────────────────────

/**
 * The axes a batch must vary across. The model declares which value each draft
 * took, which is what holds it to actually varying: a batch of six drafts that
 * all open on the signal is worthless, because then every swipe carries the
 * same meaning and the run learns nothing.
 */
export const DraftAxesSchema = z.object({
  opener: z.enum([
    "signal",
    "problem",
    "data",
    "story",
    "question",
    "social",
    "compliment",
    "pitch",
  ]),
  tone: z.enum(["blunt", "warm", "neutral", "formal"]),
  close: z.enum(["question", "cta", "statement"]),
  greeting: z.enum(["firstname", "hi", "dear"]),
  signoff: z.enum(["name", "none", "best", "regards"]),
});

// Body cap matches the transcript's JudgedSchema bound (4,000), so any draft
// the model produces can always round-trip onto the deck and back. The bound
// no longer reaches the model (the wire schema cannot carry it), so one
// long-winded draft must not sink the whole batch: keep it generous and let
// the user steer length through feedback instead.
export const DraftSchema = z.object({
  subject: z.string().max(200),
  body: z
    .string()
    .max(4_000)
    .describe("Plain text. Real line breaks, no HTML."),
  axes: DraftAxesSchema,
});

/**
 * The fictional person a batch is written to. Invented by the model from the
 * campaign ICP inside the same call that writes the drafts, so the drafts and
 * the person they address can never drift apart. A fresh persona per batch is
 * the point: judging the same voice against different plausible buyers is what
 * separates "this is how I write" from "this is what I'd say to Dana".
 */
export const PersonaSchema = z.object({
  name: z.string().max(80),
  title: z.string().max(120),
  company: z.string().max(120),
  situation: z
    .string()
    .max(300)
    .describe("One line: what is going on for them right now."),
  // Bounds here never reach the model: apiSafeSchema strips minItems /
  // maxItems from the wire schema, so this array is validated only after
  // the fact. Opus reliably invents THREE specifics when asked for "1-2",
  // and a cap of 2 rejected every batch (six good drafts, thrown away as
  // "response did not match schema", three retries in a row). Generous on
  // purpose: the prompt steers the count, the schema only stops abuse.
  signals: z
    .array(z.string().max(200))
    .min(1)
    .max(6)
    .describe("Invented but plausible specifics the drafts may reference."),
});
export type Persona = z.infer<typeof PersonaSchema>;

export const BatchSchema = z.object({
  // Present only on the invented-persona path. With a real recipient the
  // server stamps the card label itself, so the model returns drafts only.
  persona: PersonaSchema.optional(),
  drafts: z.array(DraftSchema).min(2).max(8),
});

export type Draft = z.infer<typeof DraftSchema>;
export type DraftAxes = z.infer<typeof DraftAxesSchema>;

/** How the deck (and the transcript) label the persona on a card. Shared so
 * the UI and the prompt cannot disagree about who a batch addressed. */
export function personaLabel(p: Persona): string {
  const where = [p.title, p.company]
    .map((v) => v.trim())
    .filter(Boolean)
    .join(", ");
  return where ? `${p.name} · ${where}` : p.name;
}

export const SkillSchema = z.object({
  instructions: z
    .string()
    .max(8_000)
    .describe("Imperative rules for the drafting model, one per line."),
  summary: z.string().max(500).describe("One sentence, shown in the UI."),
});

// ── Transcript ──────────────────────────────────────────────────────────────

export interface JudgedDraft {
  subject: string;
  body: string;
  axes: DraftAxes;
  kept: boolean;
  /** The persona this draft addressed, as the deck labelled it.
   * Optional: runs recorded before personas existed have none. */
  personaLabel?: string;
  /** True when the recipient was a REAL campaign contact, not an invented
   * persona. Optional: older runs never recorded it. */
  personaReal?: boolean;
  /** Phrases the user highlighted on this draft, with what they said. */
  notes?: { phrase: string; note: string }[];
}

/**
 * A voice that already exists, being changed rather than built. Carried in the
 * transcript so the skill prompt can rewrite the rules it already wrote instead
 * of starting from nothing, which is the whole of "what should be different?".
 */
export interface PriorSkill {
  instructions: string;
  summary?: string | null;
}

export interface SwipeTranscript {
  judged: JudgedDraft[];
  /** Free-text instructions typed into the panel, in order. */
  instructions: string[];
  /**
   * Cold emails the user pasted before the first batch, as they sent them.
   * Optional because most people have nothing to hand, and skipping has to stay
   * a normal path.
   */
  samples?: string[];
  /**
   * Set only when refining. Built server-side from the saved profile: the client
   * never supplies it, or a request could claim any rules it liked were already
   * accepted.
   */
  prior?: PriorSkill | null;
}

/** Bounded so a long run can't push an unbounded prompt at the operator's key. */
export const MAX_JUDGED_IN_PROMPT = 40;
export const MAX_INSTRUCTIONS_IN_PROMPT = 40;
export const MAX_SAMPLES_IN_PROMPT = 10;
/** Per sample. A paste this long is already far more than the voice needs. */
export const MAX_SAMPLE_CHARS = 8_000;

function renderTranscript(t: SwipeTranscript): string {
  const judged = t.judged.slice(-MAX_JUDGED_IN_PROMPT);
  const instructions = t.instructions.slice(-MAX_INSTRUCTIONS_IN_PROMPT);
  const samples = (t.samples ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_SAMPLES_IN_PROMPT);
  const prior = t.prior?.instructions.trim() ? t.prior : null;

  const lines: string[] = [];

  if (samples.length) {
    lines.push(
      "EMAILS THEY HAVE ACTUALLY SENT, pasted by them. This is their own writing, not a reaction to somebody else's:",
    );
    samples.forEach((s, i) => {
      lines.push(`--- sample ${i + 1} ---`, s.slice(0, MAX_SAMPLE_CHARS));
    });
    lines.push("--- end of samples ---", "");
  }

  if (prior) {
    lines.push(
      "THE RULES THEY ARE ALREADY WRITING WITH. What follows is a change to these, not a fresh start:",
      prior.instructions.trim(),
    );
    if (prior.summary?.trim()) {
      lines.push(
        `In one line, how it was described to them: ${prior.summary.trim()}`,
      );
    }
    lines.push("");
  }

  if (!judged.length && !instructions.length) {
    lines.push("Nothing judged yet. This is the opening batch.");
    return lines.join("\n");
  }

  if (judged.length) {
    lines.push("DRAFTS ALREADY JUDGED:");
    for (const d of judged) {
      // Which persona each judgement was against, so the model can avoid
      // reusing personas and never mistakes a persona detail for a voice rule.
      const to = d.personaLabel
        ? ` (to ${d.personaLabel}${d.personaReal ? ", a REAL campaign contact" : ""})`
        : "";
      lines.push(
        `- [${d.kept ? "KEPT" : "PASSED"}]${to} ${JSON.stringify(d.axes)} subject: ${d.subject}`,
      );
      lines.push(`  ${d.body.replace(/\n+/g, " ⏎ ")}`);
      for (const n of d.notes ?? []) {
        lines.push(`  ↳ highlighted “${n.phrase}” and said: ${n.note}`);
      }
    }
  }

  if (instructions.length) {
    lines.push("", "WHAT THEY HAVE TOLD YOU DIRECTLY:");
    for (const i of instructions) lines.push(`- ${i}`);
  }

  return lines.join("\n");
}

/** The saved row, as much of it as a refinement needs. */
export interface SavedVoice {
  instructions: string;
  summary?: string | null;
  /** `email_voice_profiles.source_transcript`. Shape depends on which flow wrote it. */
  source_transcript?: unknown;
}

/**
 * A stored transcript is only useful here if a swipe run wrote it. The interview
 * stores an array of turns under the same column, so the shape is checked rather
 * than assumed: replaying an interview through the swipe prompt would produce a
 * transcript claiming drafts were judged that never were.
 */
function asSwipeTranscript(value: unknown): SwipeTranscript | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const t = value as Partial<SwipeTranscript>;
  if (!Array.isArray(t.judged) || !Array.isArray(t.instructions)) return null;
  return {
    judged: t.judged,
    instructions: t.instructions,
    samples: Array.isArray(t.samples) ? t.samples : undefined,
  };
}

/**
 * "What should be different?" for a voice that already exists.
 *
 * The evidence behind the old rules is replayed where there is any, so a change
 * request narrows the voice rather than resetting it, and the rules themselves
 * ride along as `prior` so the model rewrites its own work instead of inventing
 * a new set from one sentence. A profile the interview wrote has no swipe
 * transcript to replay, and refines from its rules alone.
 */
export function buildRefinementTranscript(
  profile: SavedVoice,
  instruction: string,
): SwipeTranscript {
  const previous = asSwipeTranscript(profile.source_transcript);
  return {
    judged: previous?.judged ?? [],
    instructions: [...(previous?.instructions ?? []), instruction],
    samples: previous?.samples,
    prior: {
      instructions: profile.instructions,
      summary: profile.summary ?? null,
    },
  };
}

export interface SwipeCampaign {
  name: string;
  icp: unknown;
  offering: unknown;
  positioning: unknown;
}

/** The signed-in user, from `user_profile`. */
export interface SwipeSender {
  name?: string | null;
  roleTitle?: string | null;
  companyName?: string | null;
  offeringSummary?: string | null;
  /** Free-form profile notes: constraints and corrections the user wrote for
   * the drafter ("solo consultant", "do not use company name in sign-off"). */
  notes?: string | null;
  /** The rendered SENDER FACT BANK block, already fenced by renderFactBank.
   * Null when the user has no facts, which renders nothing. */
  factBank?: string | null;
}

/**
 * Who the emails are from. Deliberately separate from the campaign: the
 * signed-in user is always known, while campaign context often isn't. Folding
 * the sender into SwipeCampaign meant a missing campaign row silently dropped
 * the name too, and the model invented its own. The recipient is deliberately
 * absent: the model invents a fictional persona per batch (see the batch
 * system prompt), so there is no recipient to resolve.
 */
export interface SwipeSenderContext {
  sender?: SwipeSender | null;
}

function field(label: string, value?: string | null): string | null {
  const v = value?.trim();
  return v ? `${label}: ${v}` : null;
}

function renderSender(sender: SwipeSender | null | undefined): string {
  const rows = sender
    ? ([
        field("Name", sender.name),
        field("Role", sender.roleTitle),
        field("Company", sender.companyName),
        field("What they sell", sender.offeringSummary),
        field("Sender notes (follow these)", sender.notes),
      ].filter(Boolean) as string[])
    : [];

  const profile = rows.length
    ? `WHO THESE ARE FROM: sign off as this person, and never invent another name, company or offer:\n${wrapUntrusted(rows.join("\n"))}`
    : "WHO THESE ARE FROM: not known. Never invent a sender name, company or role.";

  // Already fenced by renderFactBank; wrapping it again would escape its own
  // fence and turn the facts into trusted prompt text.
  const factBank = sender?.factBank?.trim();
  return factBank ? `${profile}\n\n${factBank}` : profile;
}

/**
 * The recipient side of the batch prompt. Static text rather than resolved
 * data: the person is invented by the model, per batch, from the campaign ICP.
 * A fictional recipient means an invented signal is exercise material rather
 * than a lie, which is what lets the variation rule spread across data-led and
 * signal-led openers without fabricating claims about somebody who exists.
 */
const INVENT_RECIPIENT = `WHO THESE ARE TO: INVENT THE RECIPIENT. Before writing the drafts, invent one fictional but plausible person squarely inside the campaign's ICP (or a plausible generic B2B buyer when no campaign context is given): name, title, company, situation, and 2-3 invented specifics. Every draft in this batch is written to that same person, and you return the persona with the drafts. Recipient details are yours to invent: the person is fictional, so a made-up signal is not a lie, it is the exercise. Never reuse a persona that already appears in the judged drafts below.

THE SENDER IS REAL. Never invent facts about the sender: everything the drafts claim about who is writing (their offer, their numbers, their story) must come from the sender context above.`;

/**
 * The flip side of INVENT_RECIPIENT: the person is real, so nothing about
 * them may be invented. Enrichment lines are scraped content and ride inside
 * the untrusted fence like the sender rows.
 */
function renderRealRecipient(r: RealRecipient): string {
  const rows = [
    field("Name", r.name),
    field("Title", r.title),
    field("Company", r.company),
    field("LinkedIn headline", r.headline),
    r.signals.length
      ? `Known signals:\n${r.signals.map((s) => `- ${s}`).join("\n")}`
      : null,
  ].filter(Boolean) as string[];

  const noEnrichment = !r.headline && r.signals.length === 0;

  return `WHO THESE ARE TO: A REAL PERSON in this campaign. Every draft in this batch is written to them. Only reference the facts listed below; if none of them makes a usable opener, write a signal-free opener instead. Never invent details, signals, or history about this person.${
    noEnrichment
      ? "\nNo enrichment is available for them: assume nothing beyond the title and company."
      : ""
  }
${wrapUntrusted(rows.join("\n"))}

THE SENDER IS REAL TOO. Never invent facts about the sender: everything the drafts claim about who is writing must come from the sender context above. Do not return a persona object; return the drafts only.`;
}

function campaignBlock(campaign: SwipeCampaign | null): string {
  return campaign
    ? `THE CAMPAIGN THESE ARE FOR:\n${wrapUntrusted(
        [
          `Name: ${campaign.name}`,
          `ICP: ${JSON.stringify(campaign.icp ?? {})}`,
          `Offering: ${JSON.stringify(campaign.offering ?? {})}`,
          `Positioning: ${JSON.stringify(campaign.positioning ?? {})}`,
        ].join("\n"),
      )}`
    : "No campaign context is available. Write plausible but generic B2B cold emails.";
}

// ── Prompt 1: generate a batch ──────────────────────────────────────────────

const BATCH_SYSTEM = `You write cold emails that a founder or salesperson will judge one at a time, keeping the ones that sound like something they would have written themselves.

You are not trying to write the best possible email. You are trying to find out how THIS person writes, and the only way to do that is to give them meaningfully different things to react to.

## The variation rule: this is the whole job

Every draft in a batch must differ from the others on at least two of these axes:

- **opener**: signal (what they just shipped/announced) · problem · data · story · question · social proof · compliment · pitch
- **tone**: blunt · warm · neutral · formal
- **close**: bare question · explicit ask for a call · statement
- **greeting**: first name alone · "Hi <name>" · "Dear <name>"
- **signoff**: first name alone · no sign-off · "Best," · "Kind regards"

A batch where every draft opens on the signal in slightly different words is a failed batch. The user's keep/pass then carries no information, because there is nothing for it to distinguish. Spread the batch across the space.

Declare the axes you used for each draft honestly. Do not label a draft "blunt" and then write it warm, because those labels are read back to the user as the reason a rule was written, and a wrong label produces a wrong rule.

## Honouring what they have already told you

If they pasted emails they have actually sent, start there. That is their own writing rather than a reaction to copy somebody else wrote, so it is the truest thing you have about how this person sounds: how long their sentences run, how they greet and sign off, how blunt they are, what they never say. Write in that register by default. Do not lift their sentences, and do not reuse the content, which was written for a different prospect. Keep varying across the axes: the samples tell you where to centre the spread, not that every draft should be the same.

Anything under "WHAT THEY HAVE TOLD YOU DIRECTLY" is binding on every draft in this batch. If they said no em dashes, use none. If they said never open with a compliment, do not produce a compliment opener. Drop that axis value from your spread and vary on something else instead.

Their instructions outrank the variation rule when the two conflict. Narrowing the space is exactly what should happen as they tell you more: early batches are wide, later ones converge.

Read the KEPT and PASSED drafts the same way. If they have kept three signal-led openers and passed two compliments, stop writing compliments and start varying on the axes still in play. Keep some variation alive though, because a batch of near-identical drafts stops teaching you anything, even when they are all good.

A highlighted phrase with a note is the strongest signal available: they pointed at exact words. Treat it as a rule about those words and anything like them.

## Writing the emails themselves

- 30-90 words. These are cold emails; the user is judging voice, not admiring length.
- Reference the campaign's real offering and audience, and ground each draft in the recipient's situation and signals AS GIVEN in the recipient block. When the recipient is REAL, the no-fabrication rule in their block outranks every variation and grounding instruction here: a detail not listed for them does not exist.
- Plain text with real line breaks. No HTML, no markdown, no placeholders like [Name]. Write it as it would send.
- No emojis.

Return the drafts, plus the persona when the recipient block asked you to invent one.`;

export function buildBatchSystem(
  campaign: SwipeCampaign | null,
  context: SwipeSenderContext = {},
  recipient: RealRecipient | null = null,
): string {
  return `${BATCH_SYSTEM}\n\n---\n${UNTRUSTED_NOTICE}\n\n${renderSender(
    context.sender,
  )}\n\n${recipient ? renderRealRecipient(recipient) : INVENT_RECIPIENT}\n\n${campaignBlock(campaign)}`;
}

export function buildBatchPrompt(
  transcript: SwipeTranscript,
  count: number,
): string {
  return `${wrapUntrusted(renderTranscript(transcript))}

Write ${count} drafts for the next batch. Vary them per the rules above, and honour everything the user has told you.`;
}

// ── Prompt 2: write the skill ───────────────────────────────────────────────

const SKILL_SYSTEM = `You are writing the rule-set that a second model will follow every time it drafts cold email for this user.

What you produce is not advice for them to read. It is instructions another model will act on, so everything has to be something that model can actually do.

## Your evidence

You have four kinds, and they are not equally reliable:

1. **What they pasted**: emails they have actually sent, when there are any. The strongest evidence there is, and it outranks everything below, because it is their own writing rather than a reaction to copy somebody else wrote. Read the register straight off it: how long their sentences run, how they greet and sign off, how blunt they are, what they never say. Be careful with the content, which was written for a different prospect, and with anything that reads as a template they were handed rather than a voice.
2. **What they typed**: strong. They said it in their own words, unprompted. Quote their phrasing wherever you can; a rule carrying their words survives paraphrase better than one describing them. A phrase they highlighted with a comment is stronger still, because they pointed at the exact words.
3. **What they kept**: strong on aggregate, weak individually. Four kept drafts that all open on the signal is a rule. One kept draft that happens to be 40 words is not.
4. **What they passed**: the weakest. A pass means something in it was wrong, not that everything in it was. Only write a "never" rule when the same trait was rejected repeatedly AND never appears in anything they kept.

__RECIPIENTS_NOTE__

That ranking is about evidence, not about intent. What they pasted is the truest picture of how they write today; what they typed is the truest picture of what they want changed. So where a typed instruction contradicts everything else, follow the instruction: they are correcting themselves, not describing themselves. Someone who keeps three warm drafts and then types "stop being so friendly" has told you the drafts were the best of a bad set.

## When they already have rules

If a block of rules they are already writing with appears, this is a change and not a rebuild. Return the complete replacement set, never a diff: what you return overwrites what they have. Carry every rule they did not ask you to touch through unchanged, change the ones they did, and drop only what the change makes contradictory. A short request is not licence to rewrite their whole voice.

## Writing the rules

- Terse imperative lines a drafting model can follow. "Open on the signal, no greeting line", not "she likes getting to the point".
- Only what is specific to THIS user. A separate base prompt already covers body length, subject lines, one call to action, and avoiding AI tells. Repeating generic best practice wastes the drafting model's attention and buries what is actually about them.
- Do not invent. If the run never established how they sign off, say nothing about sign-offs. An invented rule shows up in every email they send.
- Do not pad. Six sharp rules beat fifteen soft ones. If two rules say the same thing, merge them.
- If the evidence is genuinely thin (very few keeps, nothing typed), write fewer rules and say so in the summary rather than manufacturing confidence.

\`summary\` is one human-readable sentence for the UI, e.g. "Blunt and signal-first, no pleasantries, always names a number."`;

export function buildSkillSystem(
  campaign: SwipeCampaign | null,
  context: SwipeSenderContext = {},
  hadRealRecipients = false,
): string {
  // The old static sentence flatly asserted every judged recipient was
  // fictional, which was untrue for runs addressed to real campaign
  // contacts and licensed the model to treat real details as inventions.
  const recipientsNote = hadRealRecipients
    ? "Some or all recipients in the judged drafts were REAL campaign contacts (marked in the transcript); the rest were fictional practice personas. Either way, write rules about the user's voice only; never a rule about any recipient, their company, or their situation."
    : "The recipients in the judged drafts were fictional personas invented for practice. Write rules about the user's voice only; never a rule about any persona, their company, or their situation.";
  return `${SKILL_SYSTEM.replace("__RECIPIENTS_NOTE__", recipientsNote)}\n\n---\n${UNTRUSTED_NOTICE}\n\n${renderSender(
    context.sender,
  )}\n\n${campaignBlock(campaign)}`;
}

/**
 * Drops blank and repeated rules.
 *
 * The prompt already says not to repeat itself and mostly obeys, but a run
 * produced "Never use em dashes. Use a period or a comma instead." twice
 * verbatim. These rules are read by a drafting model on every future email and
 * shown to the user as their voice, so a duplicate is both wasted attention and
 * visibly sloppy. Cheaper to guarantee here than to keep asking the prompt.
 *
 * Comparison ignores case, surrounding whitespace and trailing punctuation, so
 * near-identical restatements collapse too. Order is preserved — the model puts
 * the rules it weighted most first.
 */
export function normaliseInstructions(raw: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim().replace(/^[-•*]\s*/, "");
    if (!trimmed) continue;
    const key = trimmed
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[.;,]+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out.join("\n");
}

export function buildSkillPrompt(transcript: SwipeTranscript): string {
  const kept = transcript.judged.filter((d) => d.kept).length;
  const samples = (transcript.samples ?? []).filter((s) => s.trim()).length;
  const refining = Boolean(transcript.prior?.instructions.trim());

  const counts: string[] = [];
  // A refinement of a voice the interview built has nothing judged, and saying
  // "judged 0 drafts" invites the model to write the thin-evidence apology.
  if (transcript.judged.length || !refining) {
    counts.push(`judged ${transcript.judged.length} drafts, keeping ${kept}`);
  }
  counts.push(`typed ${transcript.instructions.length} instruction(s)`);
  if (samples) counts.push(`pasted ${samples} email(s) they had sent`);

  return `${wrapUntrusted(renderTranscript(transcript))}

They ${counts.join(", ")}.

${
  refining
    ? "They already have rules and the last instruction is what they want changed. Rewrite the rules, keep everything they did not ask about, and return the complete set."
    : "Write their voice rules."
}`;
}
