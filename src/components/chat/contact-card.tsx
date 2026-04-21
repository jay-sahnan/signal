"use client";

import { ExternalLink } from "lucide-react";

interface Contact {
  id: string;
  name: string;
  title: string | null;
  linkedinUrl: string | null;
}

interface ContactCardProps {
  contact: Contact;
}

export function ContactCard({ contact }: ContactCardProps) {
  return (
    <div className="border-border bg-background flex items-center gap-3 rounded-lg border px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{contact.name}</span>
          {contact.linkedinUrl && (
            <a
              href={
                contact.linkedinUrl.startsWith("http")
                  ? contact.linkedinUrl
                  : `https://linkedin.com/in/${contact.linkedinUrl.replace(/^\//, "")}`
              }
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        {contact.title && (
          <p className="text-muted-foreground truncate text-xs">
            {contact.title}
          </p>
        )}
      </div>
    </div>
  );
}

interface ContactCardsProps {
  contacts: Contact[];
}

export function ContactCards({ contacts }: ContactCardsProps) {
  return (
    <div className="my-1 space-y-1.5">
      {contacts.map((contact) => (
        <ContactCard key={contact.id} contact={contact} />
      ))}
    </div>
  );
}
