export interface TargetAccountList {
  id: string;
  user_id: string;
  name: string;
  original_filename: string | null;
  row_count: number;
  created_at: string;
  updated_at: string;
}

export interface TargetAccount {
  id: string;
  list_id: string;
  organization_id: string;
  raw: Record<string, string>;
  enrich_requested_at: string | null;
  /** Per-row flag stamped with enrich_requested_at; cleared when claimed. */
  skip_contact_finding: boolean;
  created_at: string;
}

/** A parsed, column-mapped CSV row ready for import. */
export interface TargetAccountRow {
  name: string;
  domain?: string | null;
  url?: string | null;
  industry?: string | null;
  location?: string | null;
  description?: string | null;
  /** Present when the file is contact-per-row (e.g. Apollo/Clay exports). */
  person?: {
    name: string;
    title?: string | null;
    email?: string | null;
    linkedin_url?: string | null;
  } | null;
  /** Everything else from the original row, preserved verbatim. */
  extra?: Record<string, string>;
}
