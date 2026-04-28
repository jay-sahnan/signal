import { saveCampaign, getCampaign, listCampaigns } from "./campaign-tools";
import {
  searchCompanies,
  discoverCompanies,
  getCompanies,
  getCompanyDetail,
  getCampaignSummary,
  searchYCCompanies,
} from "./search-tools";
import {
  searchPeople,
  enrichContact,
  extractWebContent,
  fetchSitemap,
  getContacts,
  getContactDetail,
  enrichCompany,
  enrichCompanies,
  enrichContacts,
  findContacts,
  deleteCompanies,
  deleteContacts,
  scrapeJobListings,
  scrapeJobListingsBatch,
  scoreCompany,
  scoreContact,
  updateCompanyStatus,
  getGoogleReviews,
} from "./enrichment-tools";
import {
  getUserProfile,
  updateUserProfile,
  listProfiles,
} from "./profile-tools";
import {
  getSignalAuthoringGuide,
  testSignalRecipe,
  getSignals,
  getSignalDetail,
  getCampaignSignals,
  toggleCampaignSignal,
  createSignal,
  updateSignal,
  makeSignalPublic,
  getSignalResults,
} from "./signal-tools";
import {
  fetchGitHubStargazers,
  enrichGitHubProfiles,
  searchGitHubRepos,
} from "./github-tools";
import {
  createTracking,
  bulkCreateTracking,
  getTrackingConfigs,
  getTrackingHistory,
  updateTracking,
} from "./tracking-tools";
import {
  findEmail,
  findEmails,
  writeEmail,
  sendEmail,
  sendBulkEmails,
  listDrafts,
  discardDraft,
} from "./email-tools";
import {
  createSequence,
  draftSequenceEmails,
  draftEmailsForSequence,
  getSequenceStatus,
} from "./sequence-tools";
import {
  listEmailSkills,
  getEmailSkillDetail,
  createEmailSkill,
  updateEmailSkill,
  deleteEmailSkill,
  toggleEmailSkill,
} from "./email-skill-tools";
import { getPostHogClient } from "@/lib/posthog-server";

const rawTools = {
  saveCampaign,
  getCampaign,
  listCampaigns,
  searchCompanies,
  discoverCompanies,
  getCompanies,
  getCompanyDetail,
  getCampaignSummary,
  searchYCCompanies,
  searchPeople,
  enrichContact,
  extractWebContent,
  fetchSitemap,
  getContacts,
  getContactDetail,
  getUserProfile,
  updateUserProfile,
  listProfiles,
  enrichCompany,
  enrichCompanies,
  enrichContacts,
  findContacts,
  deleteCompanies,
  deleteContacts,
  scrapeJobListings,
  scrapeJobListingsBatch,
  scoreCompany,
  scoreContact,
  updateCompanyStatus,
  getGoogleReviews,
  getSignalAuthoringGuide,
  testSignalRecipe,
  getSignals,
  getSignalDetail,
  getCampaignSignals,
  toggleCampaignSignal,
  createSignal,
  updateSignal,
  makeSignalPublic,
  getSignalResults,
  fetchGitHubStargazers,
  enrichGitHubProfiles,
  searchGitHubRepos,
  createTracking,
  bulkCreateTracking,
  getTrackingConfigs,
  getTrackingHistory,
  updateTracking,
  findEmail,
  findEmails,
  writeEmail,
  sendEmail,
  sendBulkEmails,
  listDrafts,
  discardDraft,
  createSequence,
  draftSequenceEmails,
  draftEmailsForSequence,
  getSequenceStatus,
  listEmailSkills,
  getEmailSkillDetail,
  createEmailSkill,
  updateEmailSkill,
  deleteEmailSkill,
  toggleEmailSkill,
};

type ToolCtx = { userId?: string; campaignId?: string | null };

type ToolWithExecute = {
  execute?: (input: unknown, opts: unknown) => unknown;
  [k: string]: unknown;
};

function withTelemetry<T extends ToolWithExecute>(name: string, t: T): T {
  const originalExecute = t.execute;
  if (!originalExecute) return t;
  const wrapped = async (input: unknown, opts: unknown) => {
    const start = Date.now();
    const ctx = (opts as { experimental_context?: ToolCtx } | undefined)
      ?.experimental_context;
    const distinctId = ctx?.userId ?? "anonymous";
    let success = true;
    let errorMessage: string | undefined;
    try {
      return await originalExecute(input, opts);
    } catch (err) {
      success = false;
      errorMessage = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      try {
        getPostHogClient().capture({
          distinctId,
          event: "tool_called",
          properties: {
            tool_name: name,
            success,
            duration_ms: Date.now() - start,
            campaign_id: ctx?.campaignId ?? null,
            ...(errorMessage
              ? { error: errorMessage.slice(0, 500) }
              : undefined),
          },
        });
      } catch {
        // never let telemetry break tool execution
      }
    }
  };
  return { ...t, execute: wrapped } as T;
}

export const allTools = Object.fromEntries(
  Object.entries(rawTools).map(([name, t]) => [
    name,
    withTelemetry(name, t as ToolWithExecute),
  ]),
) as typeof rawTools;
