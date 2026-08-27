/**
 * Role-family title matching for contact discovery.
 *
 * A team page lists everyone; the campaign asked for some roles. "Head of
 * Growth" should catch "Growth Lead" and "VP Growth" but not the CFO, so a
 * target title is reduced to its core (seniority words stripped) and a person
 * matches when their title contains any target's core. Deliberately loose on
 * seniority and strict on function: recall on the right department beats
 * exact wording, and the affiliation judge already handles who is real.
 */

const SENIORITY = [
  "global",
  "group",
  "senior",
  "sr",
  "junior",
  "jr",
  "principal",
  "staff",
  "founding",
  "interim",
  "acting",
  "executive",
  "chief",
  "head",
  "vp",
  "svp",
  "evp",
  "avp",
  "vice president",
  "director",
  "associate",
  "assistant",
  "lead",
  "manager",
  "officer",
  "of",
  "the",
  "and",
  "&",
];

const ABBREVIATIONS: Record<string, string> = {
  ceo: "chief executive officer",
  cto: "chief technology officer",
  cfo: "chief financial officer",
  coo: "chief operating officer",
  cmo: "chief marketing officer",
  cro: "chief revenue officer",
  cpo: "chief product officer",
  cgo: "chief growth officer",
  ciso: "chief information security officer",
  cio: "chief information officer",
};

function normalise(title: string): string {
  let t = title.toLowerCase().replace(/[^a-z0-9&+/ ]+/g, " ");
  t = t.replace(/\b([a-z]{3,4})\b/g, (m) => ABBREVIATIONS[m] ?? m);
  return t.replace(/\s+/g, " ").trim();
}

/** The function part of a title: "Head of Growth" -> "growth". */
export function titleCore(title: string): string {
  const words = normalise(title).split(" ").filter(Boolean);
  const kept = words.filter((w) => !SENIORITY.includes(w));
  // A title that was nothing but seniority ("Director", "VP") has no
  // function to match on; keep it whole so it can only match itself.
  return (kept.length > 0 ? kept : words).join(" ");
}

/**
 * Does this person's title belong to the family of any target title?
 * Untitled people never match: with no role there is nothing to compare.
 */
export function titleMatchesAny(
  personTitle: string | null | undefined,
  targets: string[],
): boolean {
  if (!personTitle) return false;
  const person = normalise(personTitle);
  if (!person) return false;
  return targets.some((target) => {
    const core = titleCore(target);
    return core.length > 0 && person.includes(core);
  });
}
