import type { TargetAccountRow } from "@/lib/types/target-list";

/**
 * Shared company-CSV parsing: a dependency-free parser plus header→field
 * mapping. Moved out of src/components/campaign/csv-upload.tsx so target-list
 * imports (chat upload, API routes) reuse the exact same behavior.
 *
 * Extensions over the original component code:
 * 1. Unmapped columns are preserved verbatim in `extra` (the campaign CSV
 *    dialog simply ignores them).
 * 2. Contact-per-row exports (Apollo/Clay/CRM) are detected via person-name
 *    columns; each row then carries a `person`. A bare `name` column always
 *    maps to the COMPANY — person names come only from explicit person
 *    aliases — and a bare `email` column belongs to the person.
 */

export const CANONICAL_FIELDS = [
  "name",
  "domain",
  "url",
  "industry",
  "location",
  "description",
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

// Column name aliases for auto-mapping (company fields)
export const COLUMN_MAP: Record<string, CanonicalField> = {
  name: "name",
  company: "name",
  company_name: "name",
  "company name": "name",
  organization: "name",
  domain: "domain",
  website: "domain",
  "website url": "domain",
  site: "domain",
  url: "url",
  link: "url",
  industry: "industry",
  sector: "industry",
  vertical: "industry",
  location: "location",
  city: "location",
  country: "location",
  hq: "location",
  headquarters: "location",
  region: "location",
  geography: "location",
  description: "description",
  about: "description",
  summary: "description",
  overview: "description",
};

type PersonField =
  | "first_name"
  | "last_name"
  | "full_name"
  | "title"
  | "email"
  | "linkedin_url";

/** Aliases for contact-per-row exports. Person mode only activates when a
 * person-NAME column exists; title/email/linkedin alone stay in `extra`. */
const PERSON_COLUMN_MAP: Record<string, PersonField> = {
  first_name: "first_name",
  "first name": "first_name",
  firstname: "first_name",
  last_name: "last_name",
  "last name": "last_name",
  lastname: "last_name",
  full_name: "full_name",
  "full name": "full_name",
  fullname: "full_name",
  "contact name": "full_name",
  contact_name: "full_name",
  title: "title",
  job_title: "title",
  "job title": "title",
  role: "title",
  email: "email",
  work_email: "email",
  "work email": "email",
  "contact email": "email",
  contact_email: "email",
  linkedin: "linkedin_url",
  linkedin_url: "linkedin_url",
  "linkedin url": "linkedin_url",
  person_linkedin: "linkedin_url",
  "person linkedin": "linkedin_url",
};

const PERSON_NAME_FIELDS: ReadonlySet<PersonField> = new Set([
  "first_name",
  "last_name",
  "full_name",
]);

export function parseCSV(text: string): {
  headers: string[];
  rows: string[][];
} {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;

  // First pass only splits lines; quotes are preserved verbatim so splitRow
  // below can still tell quoted commas from cell separators.
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        current += '"';
      }
    } else if (
      (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) &&
      !inQuotes
    ) {
      lines.push(current);
      current = "";
      if (ch === "\r") i++;
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);

  if (lines.length === 0) return { headers: [], rows: [] };

  const splitRow = (line: string): string[] => {
    const cells: string[] = [];
    let cell = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          q = !q;
        }
      } else if (ch === "," && !q) {
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += ch;
      }
    }
    cells.push(cell.trim());
    return cells;
  };

  const headers = splitRow(lines[0]);
  const rows = lines
    .slice(1)
    .map(splitRow)
    .filter((r) => r.some((c) => c));

  return { headers, rows };
}

export function mapColumns(
  headers: string[],
  rows: string[][],
): TargetAccountRow[] {
  const normalized = headers.map((h) => h.toLowerCase().trim());

  // Company-field mapping (identical to the original component logic).
  const mapping: Array<CanonicalField | null> = normalized.map(
    (h) => COLUMN_MAP[h] ?? null,
  );

  // Person columns only take effect when the file has a person-NAME column —
  // that is what marks a contact-per-row export. A bare `name` column always
  // maps to the company (COLUMN_MAP claims it above).
  const personCandidates: Array<PersonField | null> = normalized.map((h, i) =>
    mapping[i] === null ? (PERSON_COLUMN_MAP[h] ?? null) : null,
  );
  const personMode = personCandidates.some(
    (f) => f !== null && PERSON_NAME_FIELDS.has(f),
  );
  const personMapping: Array<PersonField | null> = personMode
    ? personCandidates
    : normalized.map(() => null);

  // If no "name" column was found, try the first column — unless it already
  // carries a person field (only possible in person mode, new behavior).
  if (!mapping.includes("name") && headers.length > 0 && !personMapping[0]) {
    mapping[0] = "name";
  }

  return rows.map((row) => {
    const account: TargetAccountRow = {
      name: "",
      domain: null,
      url: null,
      industry: null,
      location: null,
      description: null,
      person: null,
    };
    const person = {
      first_name: "",
      last_name: "",
      full_name: "",
      title: "",
      email: "",
      linkedin_url: "",
    };
    let extra: Record<string, string> | undefined;

    for (let i = 0; i < row.length; i++) {
      const field = mapping[i];
      if (field && row[i]) {
        if (field === "name") {
          account.name = row[i];
        } else {
          account[field] = row[i];
        }
        continue;
      }
      const personField = personMapping[i];
      if (personField) {
        if (row[i]) person[personField] = row[i];
        continue;
      }
      if (row[i]) {
        extra ??= {};
        extra[headers[i]] = row[i];
      }
    }

    // If url is set but domain isn't, try extracting domain
    if (!account.domain && account.url) {
      try {
        account.domain = new URL(
          account.url.startsWith("http")
            ? account.url
            : `https://${account.url}`,
        ).hostname.replace("www.", "");
      } catch {
        // skip
      }
    }

    if (personMode) {
      const personName =
        person.full_name ||
        [person.first_name, person.last_name].filter(Boolean).join(" ");
      if (personName) {
        account.person = {
          name: personName,
          title: person.title || null,
          email: person.email || null,
          linkedin_url: person.linkedin_url || null,
        };
      }
    }

    if (extra) account.extra = extra;
    return account;
  });
}
