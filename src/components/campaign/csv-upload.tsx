"use client";

import { useCallback, useRef, useState } from "react";
import { Upload, Sparkles, Loader2, CheckCircle2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

interface ParsedCompany {
  name: string;
  domain: string | null;
  url: string | null;
  industry: string | null;
  location: string | null;
  description: string | null;
}

interface CsvUploadProps {
  campaignId: string;
  onImported: () => void;
}

// Column name aliases for auto-mapping
const COLUMN_MAP: Record<string, keyof ParsedCompany> = {
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

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
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

function mapColumns(headers: string[], rows: string[][]): ParsedCompany[] {
  // Map header index to field
  const mapping: Array<keyof ParsedCompany | null> = headers.map((h) => {
    const normalized = h.toLowerCase().trim();
    return COLUMN_MAP[normalized] ?? null;
  });

  // If no "name" column was found, try the first column
  if (!mapping.includes("name") && headers.length > 0) {
    mapping[0] = "name";
  }

  return rows.map((row) => {
    const company: ParsedCompany = {
      name: "",
      domain: null,
      url: null,
      industry: null,
      location: null,
      description: null,
    };

    for (let i = 0; i < row.length; i++) {
      const field = mapping[i];
      if (field && row[i]) {
        if (field === "name") {
          company.name = row[i];
        } else {
          company[field] = row[i];
        }
      }
    }

    // If url is set but domain isn't, try extracting domain
    if (!company.domain && company.url) {
      try {
        company.domain = new URL(
          company.url.startsWith("http")
            ? company.url
            : `https://${company.url}`,
        ).hostname.replace("www.", "");
      } catch {
        // skip
      }
    }

    return company;
  });
}

interface EnrichmentProgress {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  current: string | null;
}

export function CsvUpload({ campaignId, onImported }: CsvUploadProps) {
  const [open, setOpen] = useState(false);
  const [companies, setCompanies] = useState<ParsedCompany[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] =
    useState<EnrichmentProgress | null>(null);
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    enriched?: number;
    enrichFailed?: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setCompanies([]);
    setHeaders([]);
    setResult(null);
    setError(null);
    setImporting(false);
    setEnriching(false);
    setEnrichProgress(null);
  };

  const handleFile = useCallback((file: File) => {
    reset();
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { headers: h, rows } = parseCSV(text);
      if (rows.length === 0) {
        setError("No data rows found in CSV");
        return;
      }
      setHeaders(h);
      const mapped = mapColumns(h, rows);
      const valid = mapped.filter((c) => c.name);
      if (valid.length === 0) {
        setError(
          "No valid companies found. Make sure the CSV has a name/company column.",
        );
        return;
      }
      setCompanies(valid);
    };
    reader.readAsText(file);
    setOpen(true);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith(".csv") || file.type === "text/csv")) {
        handleFile(file);
      }
    },
    [handleFile],
  );

  const handleImport = async (enrich = false) => {
    setImporting(true);
    setError(null);
    try {
      const res = await fetch("/api/import-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, companies }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Import failed");
        return;
      }

      if (!enrich || !data.importedLinks?.length) {
        setResult({ imported: data.imported, skipped: data.skipped });
        onImported();
        return;
      }

      // Start enrichment
      setImporting(false);
      setEnriching(true);
      const links = data.importedLinks as Array<{
        linkId: string;
        orgId: string;
        name: string;
      }>;
      const progress: EnrichmentProgress = {
        total: links.length,
        completed: 0,
        succeeded: 0,
        failed: 0,
        current: null,
      };
      setEnrichProgress({ ...progress });

      // Enrich in batches of 3 to avoid overwhelming the server
      const BATCH_SIZE = 3;
      for (let i = 0; i < links.length; i += BATCH_SIZE) {
        const batch = links.slice(i, i + BATCH_SIZE);
        progress.current = batch.map((l) => l.name).join(", ");
        setEnrichProgress({ ...progress });

        const results = await Promise.allSettled(
          batch.map((link) =>
            fetch("/api/enrich-company", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ companyId: link.linkId, campaignId }),
            }),
          ),
        );

        for (const r of results) {
          progress.completed++;
          if (r.status === "fulfilled" && r.value.ok) {
            progress.succeeded++;
          } else {
            progress.failed++;
          }
        }
        setEnrichProgress({ ...progress });
      }

      setEnriching(false);
      setResult({
        imported: data.imported,
        skipped: data.skipped,
        enriched: progress.succeeded,
        enrichFailed: progress.failed,
      });
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
      setEnriching(false);
    }
  };

  const mappedFields = headers.map((h) => {
    const normalized = h.toLowerCase().trim();
    return COLUMN_MAP[normalized] ?? null;
  });
  if (mappedFields.length > 0 && !mappedFields.includes("name")) {
    mappedFields[0] = "name";
  }

  const preview = companies.slice(0, 5);

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <Upload className="mr-1.5 h-4 w-4" />
        Import CSV
      </Button>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) reset();
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import Companies from CSV</DialogTitle>
          </DialogHeader>

          {error && (
            <div className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
              {error}
            </div>
          )}

          {enriching && enrichProgress ? (
            <div className="space-y-4">
              <div className="text-sm font-medium">
                Enriching companies... ({enrichProgress.completed}/
                {enrichProgress.total})
              </div>
              <Progress
                value={(enrichProgress.completed / enrichProgress.total) * 100}
                className="h-2"
              />
              {enrichProgress.current && (
                <div className="text-muted-foreground text-xs truncate">
                  Processing: {enrichProgress.current}
                </div>
              )}
              <div className="flex gap-4 text-xs">
                <span className="flex items-center gap-1 text-green-600">
                  <CheckCircle2 className="h-3 w-3" />{" "}
                  {enrichProgress.succeeded} enriched
                </span>
                {enrichProgress.failed > 0 && (
                  <span className="flex items-center gap-1 text-red-500">
                    <XCircle className="h-3 w-3" /> {enrichProgress.failed}{" "}
                    failed
                  </span>
                )}
              </div>
            </div>
          ) : result ? (
            <div className="space-y-3">
              <div className="bg-muted rounded-md px-4 py-3 text-sm space-y-1">
                <p>
                  <strong>{result.imported}</strong> companies imported
                  {result.skipped > 0 && (
                    <span className="text-muted-foreground">
                      {" "}
                      ({result.skipped} skipped as duplicates or invalid)
                    </span>
                  )}
                </p>
                {result.enriched !== undefined && (
                  <p className="text-green-600">
                    <strong>{result.enriched}</strong> companies enriched with
                    signals & contacts
                    {result.enrichFailed ? (
                      <span className="text-muted-foreground">
                        {" "}
                        ({result.enrichFailed} failed)
                      </span>
                    ) : null}
                  </p>
                )}
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => {
                    setOpen(false);
                    reset();
                  }}
                >
                  Done
                </Button>
              </div>
            </div>
          ) : companies.length > 0 ? (
            <div className="space-y-3">
              <div className="text-muted-foreground text-sm">
                {companies.length}{" "}
                {companies.length === 1 ? "company" : "companies"} found
              </div>

              {/* Column mapping display */}
              <div className="flex flex-wrap gap-1.5">
                {headers.map((h, i) => (
                  <span
                    key={i}
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      mappedFields[i]
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {h}
                    {mappedFields[i] && mappedFields[i] !== h.toLowerCase() && (
                      <span className="opacity-60"> → {mappedFields[i]}</span>
                    )}
                    {!mappedFields[i] && (
                      <span className="opacity-60"> (ignored)</span>
                    )}
                  </span>
                ))}
              </div>

              {/* Preview table */}
              <div className="border-border overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="px-3 py-1.5 text-left text-xs font-medium">
                        Name
                      </th>
                      <th className="px-3 py-1.5 text-left text-xs font-medium">
                        Domain
                      </th>
                      <th className="px-3 py-1.5 text-left text-xs font-medium">
                        Industry
                      </th>
                      <th className="px-3 py-1.5 text-left text-xs font-medium">
                        Location
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((c, i) => (
                      <tr key={i} className="border-border border-t">
                        <td className="px-3 py-1.5">{c.name}</td>
                        <td className="text-muted-foreground px-3 py-1.5">
                          {c.domain || "--"}
                        </td>
                        <td className="text-muted-foreground px-3 py-1.5">
                          {c.industry || "--"}
                        </td>
                        <td className="text-muted-foreground px-3 py-1.5">
                          {c.location || "--"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {companies.length > 5 && (
                  <div className="text-muted-foreground border-border border-t px-3 py-1.5 text-xs">
                    + {companies.length - 5} more
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setOpen(false);
                    reset();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleImport(false)}
                  disabled={importing}
                >
                  {importing ? (
                    <>
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    `Import ${companies.length}`
                  )}
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleImport(true)}
                  disabled={importing}
                >
                  {importing ? (
                    <>
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-1.5 h-3 w-3" />
                      Import & Enrich
                    </>
                  )}
                </Button>
              </div>
            </div>
          ) : !error ? (
            <div className="text-muted-foreground py-8 text-center text-sm">
              Parsing CSV...
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
