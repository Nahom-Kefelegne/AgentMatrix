'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface DashboardV2SettingsResponse {
  dashboardV2?: boolean;
}

export function useDashboardV2Flag() {
  const [storedEnabled, setStoredEnabledState] = useState(true);
  const [override, setOverride] = useState<boolean | null>(null);
  const [loaded, setLoaded] = useState(false);
  const localRevisionRef = useRef(0);

  const setStoredEnabled = useCallback((enabled: boolean) => {
    localRevisionRef.current += 1;
    setStoredEnabledState(enabled);
  }, []);

  useEffect(() => {
    const queryValue = new URLSearchParams(window.location.search).get('dashboardV2');
    const queryOverride = queryValue === '1' ? true : queryValue === '0' ? false : null;
    setOverride(queryOverride);
    if (queryOverride !== null) setLoaded(true);

    const controller = new AbortController();
    const requestRevision = localRevisionRef.current;
    let active = true;

    fetch('/api/settings', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Settings request failed (${response.status})`);
        return response.json() as Promise<DashboardV2SettingsResponse>;
      })
      .then(data => {
        if (!active || requestRevision !== localRevisionRef.current) return;
        // Missing/older settings payloads must preserve the product default.
        setStoredEnabledState(data.dashboardV2 !== false);
      })
      .catch(error => {
        if (!active || controller.signal.aborted) return;
        console.error('[dashboard-v2-flag]', error);
      })
      .finally(() => {
        if (active) setLoaded(true);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return {
    enabled: override ?? storedEnabled,
    storedEnabled,
    override,
    loaded,
    setStoredEnabled,
  };
}
