import type { Integration } from "@/lib/integrations";

interface MissingKeyBannerProps {
  integration: Integration;
  missingEnvVars: string[];
}

/**
 * One banner row for a single missing required integration. Rendered by
 * `<MissingKeyBannerStack />` — never mount directly; the stack handles
 * status fetching, severity filtering, and ordering.
 */
export function MissingKeyBanner({
  integration,
  missingEnvVars,
}: MissingKeyBannerProps) {
  return (
    <div
      role="alert"
      className="border-b border-amber-500/30 bg-amber-500/15 px-4 py-2 text-sm"
    >
      <strong>{integration.name} not configured.</strong>{" "}
      {integration.consequence}{" "}
      <span className="text-muted-foreground">
        Missing:{" "}
        {missingEnvVars.map((v, i) => (
          <span key={v}>
            {i > 0 && ", "}
            <code className="rounded bg-amber-500/20 px-1">{v}</code>
          </span>
        ))}
        . {integration.fixHint && <>{integration.fixHint}. </>}
      </span>
      {integration.signupUrl && (
        <a
          href={integration.signupUrl}
          target="_blank"
          rel="noreferrer"
          className="ml-1 underline"
        >
          Get a key →
        </a>
      )}
    </div>
  );
}
