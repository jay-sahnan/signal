import { describe, expect, it } from "vitest";

import { titleCore, titleMatchesAny } from "@/lib/services/title-match";

describe("titleCore", () => {
  it("strips seniority and keeps the function", () => {
    expect(titleCore("Head of Growth")).toBe("growth");
    expect(titleCore("VP, Marketing")).toBe("marketing");
    expect(titleCore("Senior Growth Engineer")).toBe("growth engineer");
    expect(titleCore("Director of Revenue Operations")).toBe(
      "revenue operations",
    );
  });
  it("expands C-level abbreviations", () => {
    expect(titleCore("CTO")).toBe("technology");
  });
  it("keeps a seniority-only title whole", () => {
    expect(titleCore("Director")).toBe("director");
  });
});

describe("titleMatchesAny", () => {
  const targets = ["Head of Growth", "Growth Engineer", "CTO"];
  it("matches the same role family at any seniority", () => {
    expect(titleMatchesAny("Growth Lead", targets)).toBe(true);
    expect(titleMatchesAny("VP Growth", targets)).toBe(true);
    expect(titleMatchesAny("Head of Product Growth", targets)).toBe(true);
    expect(titleMatchesAny("Growth Engineering Manager", targets)).toBe(true);
    expect(titleMatchesAny("Co-founder & CTO", targets)).toBe(true);
    expect(titleMatchesAny("Chief Technology Officer", targets)).toBe(true);
  });
  it("matches whole words only, never substrings", () => {
    expect(titleMatchesAny("Digital Marketing Manager", ["Head of IT"])).toBe(
      false,
    );
    expect(titleMatchesAny("IT Manager", ["Head of IT"])).toBe(true);
    expect(titleMatchesAny("Item Coordinator", ["Head of IT"])).toBe(false);
  });
  it("matches multi-word roles in any order and inflection", () => {
    expect(titleMatchesAny("Engineer, Growth", ["Growth Engineer"])).toBe(true);
    expect(
      titleMatchesAny("VP of Operations, Revenue", ["Revenue Operations Lead"]),
    ).toBe(true);
    expect(titleMatchesAny("Growth Marketing", ["Growth Engineer"])).toBe(
      false,
    );
  });
  it("rejects other departments", () => {
    expect(titleMatchesAny("CFO", targets)).toBe(false);
    expect(titleMatchesAny("Software Engineer", targets)).toBe(false);
    expect(titleMatchesAny("Head of Design", targets)).toBe(false);
    expect(titleMatchesAny("Office Manager", targets)).toBe(false);
  });
  it("never matches an untitled person", () => {
    expect(titleMatchesAny(null, targets)).toBe(false);
    expect(titleMatchesAny("", targets)).toBe(false);
  });
});
