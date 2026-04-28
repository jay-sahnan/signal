"use client";

import { useEffect, useState } from "react";

export interface IntegrationStatus {
  id: string;
  configured: boolean;
  missingEnvVars: string[];
}

interface State {
  statuses: IntegrationStatus[] | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches the configuration status of every integration once on mount.
 * Used by the missing-key banner and the settings integrations panel.
 *
 * Fails closed: if the API call fails (e.g. user is logged out, server
 * down), `statuses` stays null and the banner renders nothing rather than
 * incorrectly claiming everything is missing.
 */
export function useIntegrationsStatus(): State {
  const [statuses, setStatuses] = useState<IntegrationStatus[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/integrations/status")
      .then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.json();
      })
      .then((data: { statuses: IntegrationStatus[] }) => {
        if (cancelled) return;
        setStatuses(data.statuses);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { statuses, loading, error };
}
