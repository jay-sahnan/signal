"use client";

import { useCallback, useRef, useState } from "react";
import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api-fetch";
import { COLUMN_MAP, mapColumns, parseCSV } from "@/lib/csv/company-csv";
import { MAX_ROWS_PER_REQUEST } from "@/lib/import-limits";
import type { TargetAccountRow } from "@/lib/types/target-list";

interface CsvUploadProps {
  campaignId: string;
  onImported: () => void;
}

export function CsvUpload({ campaignId, onImported }: CsvUploadProps) {
  const [open, setOpen] = useState(false);
  const [companies, setCompanies] = useState<TargetAccountRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setCompanies([]);
    setHeaders([]);
    setResult(null);
    setError(null);
    setImporting(false);
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

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    // The API caps rows per request; send big files as sequential batches
    // and keep whatever earlier batches already imported if a later one dies.
    let imported = 0;
    let skipped = 0;
    try {
      for (let i = 0; i < companies.length; i += MAX_ROWS_PER_REQUEST) {
        const batch = companies.slice(i, i + MAX_ROWS_PER_REQUEST);
        const res = await apiFetch("/api/import-csv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaignId, companies: batch }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(
            imported + skipped > 0
              ? `Imported ${imported} (${skipped} skipped) before batch ${Math.floor(i / MAX_ROWS_PER_REQUEST) + 1} failed: ${data.error || "Import failed"}`
              : data.error || "Import failed",
          );
          if (imported > 0) onImported();
          return;
        }
        imported += data.imported ?? 0;
        skipped += (data.skipped ?? 0) + (data.failed ?? 0);
      }
      setResult({ imported, skipped });
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      if (imported > 0) onImported();
    } finally {
      setImporting(false);
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

          {result ? (
            <div className="space-y-3">
              <div className="bg-muted rounded-md px-4 py-3 text-sm">
                <p>
                  <strong>{result.imported}</strong> companies imported
                  {result.skipped > 0 && (
                    <span className="text-muted-foreground">
                      {" "}
                      ({result.skipped} skipped as duplicates or invalid)
                    </span>
                  )}
                </p>
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
                <Button size="sm" onClick={handleImport} disabled={importing}>
                  {importing
                    ? "Importing..."
                    : `Import ${companies.length} ${companies.length === 1 ? "company" : "companies"}`}
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
