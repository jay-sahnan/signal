# Security Policy

## Reporting a vulnerability

**Do not open a public issue** for security reports.

Use either of these channels:

1. **GitHub Security Advisories** — [open a private advisory](../../security/advisories/new) against this repository. Preferred.
2. **Email** — `jaysahnan31@gmail.com`.

Include:

- A clear description of the issue and potential impact.
- Reproduction steps, including any PoC code or specific requests.
- The commit SHA or release version you tested against.
- Your contact info if you want acknowledgment or a public credit.

## Response timelines

| Stage                          | Target   |
| ------------------------------ | -------- |
| Acknowledgment of report       | 72 hours |
| Initial triage / severity call | 7 days   |
| Fix merged — critical          | 90 days  |
| Fix merged — non-critical      | 180 days |
| CVE publication after patch    | 24 hours |

These are targets, not SLAs. We'll keep you in the loop if something slips.

## Scope

- This repository (`signal`), its release artifacts, and Docker images.
- Reproducible issues against `main` or the latest tagged release.

Out of scope:

- Issues in third-party services (Supabase, Anthropic, Browserbase, AgentMail, etc.) — report those to the respective vendor.
- Findings that require a local compromise of the self-hoster's environment.
- Social-engineering or physical attacks.
- Denial of service via unbounded input where the fix is documented rate-limiting.
- AI-generated reports without a working PoC — we require reproduction evidence, not speculative analysis.

## Safe harbor

Good-faith research is welcome. We won't pursue legal action against researchers who:

- Stay within the scope above.
- Make a reasonable effort to avoid impacting other users or data.
- Give us a reasonable window to investigate and fix before public disclosure.

If you're unsure whether something counts as good-faith, reach out before testing.

## Disclosure

Once a fix is released, we'll publish an advisory (CVE where applicable) crediting the reporter if they want credit. You're welcome to publish your own write-up 48 hours after the advisory lands.
