export interface ICP {
  industry?: string;
  companySize?: string;
  geography?: string;
  targetTitles?: string[];
  painPoints?: string[];
  keywords?: string[];
}

export interface Offering {
  description?: string;
  valueProposition?: string;
  differentiators?: string[];
}

export interface Positioning {
  angle?: string;
  tone?: string;
  keyMessages?: string[];
}

export interface Campaign {
  id: string;
  name: string;
  status: string;
  profile_id: string | null;
  icp_preset_slug: string | null;
  icp: ICP;
  offering: Offering;
  positioning: Positioning;
  search_criteria: Record<string, unknown>;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactCompany {
  name: string;
  domain: string | null;
  industry: string | null;
}

export interface LinkedInPost {
  text: string;
  url: string;
  created_at: string;
  likes: number;
  comments: number;
  reposts: number;
}

export interface Tweet {
  text: string;
  created_at: string;
  public_metrics?: {
    like_count?: number;
    reply_count?: number;
    view_count?: number;
  };
}

export interface WebResearchResult {
  title: string;
  url: string;
  publishedDate: string | null;
  text: string | null;
}

export interface EnrichmentData {
  searchQuery?: string;
  rawTitle?: string;
  text?: string;
  linkedin?: {
    profile: Record<string, unknown> | null;
    profileInfo: {
      username: string;
      name: string;
      headline: string;
    } | null;
    posts: LinkedInPost[];
  };
  twitter?: {
    user: {
      username: string;
      name: string;
      description?: string;
      followers_count?: number;
      tweet_count?: number;
    };
    tweets: Tweet[];
  };
  news?: WebResearchResult[];
  articles?: WebResearchResult[];
  background?: WebResearchResult[];
}

export interface CompanyEnrichmentData {
  website?: {
    title: string;
    description: string;
    content: string;
    summary?: string;
    openGraph?: Record<string, string>;
    emails?: string[];
    phones?: string[];
    address?: string;
  };
  searches?: Array<{
    category: string;
    query: string;
    results: Array<{
      title: string;
      url: string;
      publishedDate: string | null;
      text: string | null;
      summary?: string;
    }>;
  }>;
  hiring?: {
    careersUrl?: string;
    jobs: Array<{
      title: string;
      department?: string;
      location?: string;
      url?: string;
    }>;
    scrapedAt: string;
  };
  yc?: {
    batch: string | null;
    ycUrl: string;
    longDescription: string | null;
    founders: Array<{
      name: string;
      title: string | null;
      linkedin: string | null;
    }>;
    teamSize: string | null;
    isHiring: boolean;
    scrapedAt: string;
  };
  enrichedAt?: string;
  errors?: string[];
}

export interface Organization {
  id: string;
  name: string;
  domain: string | null;
  url: string | null;
  industry: string | null;
  location: string | null;
  description: string | null;
  enrichment_data: CompanyEnrichmentData | Record<string, never>;
  enrichment_status: "pending" | "enriched" | "failed";
  last_enriched_at: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

export interface Person {
  id: string;
  name: string;
  linkedin_url: string | null;
  work_email: string | null;
  personal_email: string | null;
  work_email_verified_at: string | null;
  personal_email_verified_at: string | null;
  twitter_url: string | null;
  title: string | null;
  organization_id: string | null;
  enrichment_data: EnrichmentData;
  enrichment_status: "pending" | "in_progress" | "enriched" | "failed";
  last_enriched_at: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
  organization?: Organization;
}

export interface CampaignOrganization {
  id: string;
  campaign_id: string;
  organization_id: string;
  relevance_score: number | null;
  score_reason: string | null;
  status: "discovered" | "qualified" | "disqualified";
  created_at: string;
  updated_at: string;
  organization?: Organization;
}

export interface CampaignPerson {
  id: string;
  campaign_id: string;
  person_id: string;
  outreach_status:
    | "not_contacted"
    | "queued"
    | "sent"
    | "delivered"
    | "opened"
    | "clicked"
    | "replied"
    | "bounced"
    | "complained";
  priority_score: number | null;
  score_reason: string | null;
  created_at: string;
  updated_at: string;
  person?: Person;
}

// View model types for frontend components (flat shape, mapped from joined queries)
export interface CampaignCompany {
  id: string;
  organization_id: string;
  campaign_id: string;
  name: string;
  domain: string | null;
  url: string | null;
  industry: string | null;
  location: string | null;
  description: string | null;
  relevance_score: number | null;
  score_reason: string | null;
  status: "discovered" | "qualified" | "disqualified";
  readiness_tag: "ready_to_contact" | "monitoring" | "not_ready" | null;
  enrichment_data: CompanyEnrichmentData | Record<string, never>;
  suggested_approach: string | null;
  approach_generated_at: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignContact {
  id: string;
  person_id: string;
  campaign_id: string;
  organization_id: string | null;
  name: string;
  title: string | null;
  work_email: string | null;
  personal_email: string | null;
  work_email_verified_at: string | null;
  personal_email_verified_at: string | null;
  linkedin_url: string | null;
  twitter_url: string | null;
  enrichment_status: "pending" | "in_progress" | "enriched" | "failed";
  enrichment_data: EnrichmentData;
  outreach_status:
    | "not_contacted"
    | "queued"
    | "sent"
    | "delivered"
    | "opened"
    | "clicked"
    | "replied"
    | "bounced"
    | "complained";
  priority_score: number | null;
  score_reason: string | null;
  readiness_tag: "ready_to_contact" | "monitoring" | "not_ready" | null;
  generated_email_subject: string | null;
  generated_email_body: string | null;
  email_generated_at: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
  company: ContactCompany | null;
}
