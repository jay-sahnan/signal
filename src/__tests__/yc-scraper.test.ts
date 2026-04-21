import { describe, it, expect } from "vitest";
import {
  buildYCDirectoryUrl,
  type YCCompanyDetail,
  type YCFilters,
} from "@/lib/services/yc-scraper";

describe("buildYCDirectoryUrl", () => {
  it("builds base URL with no filters", () => {
    expect(buildYCDirectoryUrl({})).toBe(
      "https://www.ycombinator.com/companies",
    );
  });

  it("includes batch filter", () => {
    const url = buildYCDirectoryUrl({ batch: "Winter 2025" });
    expect(url).toContain("batch=Winter+2025");
  });

  it("includes multiple filters", () => {
    const url = buildYCDirectoryUrl({
      batch: "Summer 2025",
      industry: "Healthcare",
      query: "diagnostics",
    });
    expect(url).toContain("batch=Summer+2025");
    expect(url).toContain("industry=Healthcare");
    expect(url).toContain("q=diagnostics");
  });

  it("includes isHiring filter", () => {
    const url = buildYCDirectoryUrl({ isHiring: true });
    expect(url).toContain("is_hiring=true");
  });

  it("includes teamSize filter", () => {
    const url = buildYCDirectoryUrl({ teamSize: "11-50" });
    expect(url).toContain("team_size=11-50");
  });

  it("includes region filter", () => {
    const url = buildYCDirectoryUrl({ region: "Europe" });
    expect(url).toContain("regions=Europe");
  });
});

describe("YC scraper types", () => {
  it("YCFilters accepts all filter fields", () => {
    const filters: YCFilters = {
      batch: "Winter 2025",
      industry: "Healthcare",
      region: "Europe",
      teamSize: "11-50",
      isHiring: true,
      query: "diagnostics",
    };
    expect(filters.batch).toBe("Winter 2025");
  });

  it("YCCompanyDetail has expected shape", () => {
    const company: YCCompanyDetail = {
      name: "Test Co",
      oneLiner: "A test company",
      longDescription: "Longer description",
      url: "https://test.co",
      ycUrl: "https://www.ycombinator.com/companies/test-co",
      batch: "Winter 2025",
      industry: "Healthcare",
      location: "San Francisco, CA",
      teamSize: "11-50",
      founders: [{ name: "Jane", title: "CEO", linkedin: null }],
      isHiring: true,
    };
    expect(company.founders).toHaveLength(1);
  });
});
