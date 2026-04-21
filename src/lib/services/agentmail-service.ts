import { AgentMailClient } from "agentmail";

let client: AgentMailClient | null = null;

function getClient(): AgentMailClient {
  if (!client) {
    const apiKey = process.env.AGENTMAIL_API_KEY;
    if (!apiKey) {
      throw new Error(
        "AGENTMAIL_API_KEY environment variable is not set. Add it to .env.local.",
      );
    }
    client = new AgentMailClient({ apiKey });
  }
  return client;
}

export async function listInboxes() {
  const c = getClient();
  const response = await c.inboxes.list();
  return response.inboxes;
}

export async function createInbox(displayName: string) {
  const c = getClient();
  return c.inboxes.create({ displayName });
}

export async function sendMessage(
  inboxId: string,
  params: { to: string; subject: string; text?: string; html?: string },
) {
  const c = getClient();
  return c.inboxes.messages.send(inboxId, {
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  });
}

export async function getMessage(inboxId: string, messageId: string) {
  const c = getClient();
  return c.inboxes.messages.get(inboxId, messageId);
}

export async function listThreads(inboxId: string) {
  const c = getClient();
  return c.inboxes.threads.list(inboxId);
}

export async function getThread(inboxId: string, threadId: string) {
  const c = getClient();
  return c.inboxes.threads.get(inboxId, threadId);
}

export async function replyToMessage(
  inboxId: string,
  messageId: string,
  params: { text?: string; html?: string },
) {
  const c = getClient();
  return c.inboxes.messages.reply(inboxId, messageId, params);
}
