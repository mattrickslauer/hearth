/**
 * Hub claim + unpair — the state and handlers behind the dashboard's "Connect a hub" sheet and
 * the per-hub Unpair action. Extracted from the dashboard god component so the screen keeps only
 * the wiring; the hub list itself stays in the screen (many things read it), and this hook mutates
 * it through the passed setter.
 */

import { useState, type Dispatch, type SetStateAction } from 'react';

import { claimHub, unpairHub, type HubView } from '@/lib/hubs';

export function useHubClaim(opts: {
  token?: string | null;
  /** Full reload after a successful claim — a new hub changes the whole world. */
  reload: () => Promise<void>;
  setHubs: Dispatch<SetStateAction<HubView[] | null>>;
  closeSheet: () => void;
}) {
  const { token, reload, setHubs, closeSheet } = opts;

  const [claimCode, setClaimCode] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [hubError, setHubError] = useState<string | null>(null);
  const [hubNotice, setHubNotice] = useState<string | null>(null);

  const submitClaim = async () => {
    const code = claimCode.trim();
    if (!code || claiming) return;
    setClaiming(true);
    setHubError(null);
    setHubNotice(null);
    try {
      const hub = await claimHub(code, token);
      setClaimCode('');
      setHubNotice(`Connected “${hub.name}”. It’ll come online once it checks in.`);
      await reload();
    } catch (err) {
      setHubError((err as Error).message);
    } finally {
      setClaiming(false);
    }
  };

  const removeHub = async (hub: HubView) => {
    setHubError(null);
    setHubNotice(null);
    try {
      await unpairHub(hub.id, token);
      setHubs((prev) => (prev ? prev.filter((h) => h.id !== hub.id) : prev));
      closeSheet();
    } catch (err) {
      setHubError((err as Error).message);
    }
  };

  return { claimCode, setClaimCode, claiming, hubError, hubNotice, submitClaim, removeHub };
}
