import { describe, expect, it } from "vitest";

import { COLUMN_MAP, mapColumns, parseCSV } from "@/lib/csv/company-csv";

describe("parseCSV", () => {
  it("parses headers and rows", () => {
    const { headers, rows } = parseCSV(
      "name,domain\nAcme,acme.com\nBeta,beta.io",
    );
    expect(headers).toEqual(["name", "domain"]);
    expect(rows).toEqual([
      ["Acme", "acme.com"],
      ["Beta", "beta.io"],
    ]);
  });

  it("handles quoted fields with commas and escaped quotes", () => {
    const { headers, rows } = parseCSV(
      'name,description\n"Acme, Inc","Makes ""things"", well"',
    );
    expect(headers).toEqual(["name", "description"]);
    expect(rows).toEqual([["Acme, Inc", 'Makes "things", well']]);
  });

  it("handles CRLF line endings", () => {
    const { rows } = parseCSV(
      "name,domain\r\nAcme,acme.com\r\nBeta,beta.io\r\n",
    );
    expect(rows).toEqual([
      ["Acme", "acme.com"],
      ["Beta", "beta.io"],
    ]);
  });

  it("keeps newlines inside quoted fields", () => {
    const { rows } = parseCSV('name,notes\n"Acme","line one\nline two"');
    expect(rows).toEqual([["Acme", "line one\nline two"]]);
  });

  it("drops rows that are entirely empty", () => {
    const { rows } = parseCSV("name,domain\nAcme,acme.com\n,\n");
    expect(rows).toEqual([["Acme", "acme.com"]]);
  });

  it("returns empty shape for empty input", () => {
    expect(parseCSV("")).toEqual({ headers: [], rows: [] });
  });
});

describe("mapColumns — company fields", () => {
  it("maps common aliases (company_name→name, website→domain, hq→location)", () => {
    const rows = mapColumns(
      ["company_name", "website", "hq"],
      [["Acme", "acme.com", "Berlin"]],
    );
    expect(rows[0]).toMatchObject({
      name: "Acme",
      domain: "acme.com",
      location: "Berlin",
    });
    expect(COLUMN_MAP["company name"]).toBe("name");
  });

  it("falls back to the first column when no name column maps", () => {
    const rows = mapColumns(["brand", "industry"], [["Acme", "SaaS"]]);
    expect(rows[0].name).toBe("Acme");
    expect(rows[0].industry).toBe("SaaS");
  });

  it("derives domain from url when domain is missing", () => {
    const rows = mapColumns(
      ["company", "url"],
      [["Acme", "https://www.acme.com/about"]],
    );
    expect(rows[0].domain).toBe("acme.com");
    expect(rows[0].url).toBe("https://www.acme.com/about");
  });

  it("collects unmapped columns into extra, keyed by original header", () => {
    const rows = mapColumns(
      ["company", "Employee Count", "Funding Stage"],
      [
        ["Acme", "120", "Series B"],
        ["Beta", "", "Seed"],
      ],
    );
    expect(rows[0].extra).toEqual({
      "Employee Count": "120",
      "Funding Stage": "Series B",
    });
    // empty cells are not preserved as extra keys
    expect(rows[1].extra).toEqual({ "Funding Stage": "Seed" });
  });

  it("omits extra when every column is mapped", () => {
    const rows = mapColumns(["company", "website"], [["Acme", "acme.com"]]);
    expect(rows[0].extra).toBeUndefined();
  });
});

describe("mapColumns — person columns (contact-per-row files)", () => {
  it("maps a contact-per-row file: 3 rows, 2 companies, person on every row", () => {
    const rows = mapColumns(
      [
        "first_name",
        "last_name",
        "title",
        "email",
        "linkedin_url",
        "company",
        "website",
      ],
      [
        [
          "Jane",
          "Doe",
          "VP Sales",
          "jane@acme.com",
          "https://linkedin.com/in/jane",
          "Acme",
          "acme.com",
        ],
        [
          "John",
          "Smith",
          "CTO",
          "john@acme.com",
          "https://linkedin.com/in/john",
          "Acme",
          "acme.com",
        ],
        [
          "Ann",
          "Lee",
          "CEO",
          "ann@beta.io",
          "https://linkedin.com/in/ann",
          "Beta",
          "beta.io",
        ],
      ],
    );

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.name)).toEqual(["Acme", "Acme", "Beta"]);
    expect(new Set(rows.map((r) => r.domain))).toEqual(
      new Set(["acme.com", "beta.io"]),
    );
    expect(rows[0].person).toEqual({
      name: "Jane Doe",
      title: "VP Sales",
      email: "jane@acme.com",
      linkedin_url: "https://linkedin.com/in/jane",
    });
    expect(rows[2].person).toEqual({
      name: "Ann Lee",
      title: "CEO",
      email: "ann@beta.io",
      linkedin_url: "https://linkedin.com/in/ann",
    });
    // person columns do not leak into extra
    for (const r of rows) expect(r.extra).toBeUndefined();
  });

  it("maps full_name / job_title / work_email / person_linkedin aliases", () => {
    const rows = mapColumns(
      [
        "full_name",
        "job_title",
        "work_email",
        "person_linkedin",
        "organization",
      ],
      [
        [
          "Jane Doe",
          "Head of Ops",
          "jane@acme.com",
          "https://linkedin.com/in/jane",
          "Acme",
        ],
      ],
    );
    expect(rows[0].name).toBe("Acme");
    expect(rows[0].person).toEqual({
      name: "Jane Doe",
      title: "Head of Ops",
      email: "jane@acme.com",
      linkedin_url: "https://linkedin.com/in/jane",
    });
  });

  it("maps 'contact name' and 'contact email' aliases", () => {
    const rows = mapColumns(
      ["Contact Name", "Contact Email", "Company"],
      [["Jane Doe", "jane@acme.com", "Acme"]],
    );
    expect(rows[0].name).toBe("Acme");
    expect(rows[0].person).toEqual({
      name: "Jane Doe",
      title: null,
      email: "jane@acme.com",
      linkedin_url: null,
    });
  });

  it("keeps a bare name column as the COMPANY even alongside person columns", () => {
    // Clay-style export: "name" is the company, "full_name" is the person.
    const rows = mapColumns(
      ["name", "full_name", "email"],
      [["Acme", "Jane Doe", "jane@acme.com"]],
    );
    expect(rows[0].name).toBe("Acme");
    expect(rows[0].person).toMatchObject({
      name: "Jane Doe",
      email: "jane@acme.com",
    });
  });

  it("yields person: null on every row of a companies-only file", () => {
    const rows = mapColumns(
      ["company", "website", "industry"],
      [
        ["Acme", "acme.com", "SaaS"],
        ["Beta", "beta.io", "Fintech"],
      ],
    );
    for (const r of rows) expect(r.person).toBeNull();
  });

  it("does not enter person mode without a person-name column", () => {
    // title/email alone are ambiguous — without a person name they stay extra.
    const rows = mapColumns(
      ["company", "title", "email"],
      [["Acme", "Some Report", "info@acme.com"]],
    );
    expect(rows[0].person).toBeNull();
    expect(rows[0].extra).toEqual({
      title: "Some Report",
      email: "info@acme.com",
    });
  });

  it("yields person: null on rows where the person name cells are empty", () => {
    const rows = mapColumns(
      ["first_name", "last_name", "email", "company"],
      [
        ["Jane", "Doe", "jane@acme.com", "Acme"],
        ["", "", "info@beta.io", "Beta"],
      ],
    );
    expect(rows[0].person).toMatchObject({ name: "Jane Doe" });
    expect(rows[1].person).toBeNull();
  });
});
