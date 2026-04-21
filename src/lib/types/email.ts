export interface EmailSettings {
  agentmail_inbox_id: string | null;
  from_name: string | null;
  reply_to_email: string | null;
  is_configured: boolean;
}

export interface EmailDraft {
  id: string;
  campaign_id: string;
  person_id: string;
  campaign_people_id: string;
  user_id: string;
  to_email: string;
  subject: string;
  body_html: string;
  body_text: string | null;
  reply_to: string | null;
  status: "draft" | "queued" | "sent" | "discarded";
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SentEmail {
  id: string;
  agentmail_message_id: string;
  draft_id: string | null;
  campaign_people_id: string;
  campaign_id: string;
  person_id: string;
  user_id: string;
  to_email: string;
  from_email: string;
  subject: string;
  status: string;
  sent_at: string;
  created_at: string;
}

export interface AgentMailInbox {
  inbox_id: string;
  display_name: string | null;
}
