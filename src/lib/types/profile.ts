export interface UserProfile {
  id: string;
  label: string | null;
  name: string | null;
  email: string | null;
  company_name: string | null;
  company_url: string | null;
  personal_url: string | null;
  linkedin_url: string | null;
  twitter_url: string | null;
  role_title: string | null;
  offering_summary: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type ProfileFormData = Omit<
  UserProfile,
  "id" | "created_at" | "updated_at"
>;

export function profileDisplayName(p: UserProfile): string {
  if (p.label) return p.label;
  if (p.company_name && p.name) return `${p.name} - ${p.company_name}`;
  return p.name || p.company_name || p.email || "Untitled Profile";
}
