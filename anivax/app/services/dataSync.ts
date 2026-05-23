/**
 * Reactive cache invalidation for REST mutations (TanStack Query).
 * - Same tab: {@link notifyDataChanged} → {@link invalidateByScope}
 * - Other tabs: BroadcastChannel + localStorage → {@link invalidateByScope}
 */

import { invalidateByScope } from "../lib/queryClient";
import type { DataSyncScope } from "../lib/dataSyncScope";

export type { DataSyncScope };

type SyncPayload = {
  scope: DataSyncScope;
  at: number;
};

const CHANNEL_NAME = "anivax-data-sync";
const STORAGE_KEY = "anivax.dataSync";

let channel: BroadcastChannel | null = null;
let crossTabReady = false;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function publishToOtherTabs(scope: DataSyncScope): void {
  if (!isBrowser()) return;

  const payload: SyncPayload = { scope, at: Date.now() };

  try {
    channel?.postMessage(payload);
  } catch {
    /* BroadcastChannel unavailable */
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* private mode / quota */
  }
}

function onRemoteInvalidate(scope: DataSyncScope): void {
  void invalidateByScope(scope);
}

function ensureCrossTabListeners(): void {
  if (!isBrowser() || crossTabReady) return;
  crossTabReady = true;

  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event: MessageEvent<SyncPayload>) => {
      const scope = event.data?.scope;
      if (scope) onRemoteInvalidate(scope);
    };
  }

  window.addEventListener("storage", (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      const data = JSON.parse(event.newValue) as SyncPayload;
      if (data?.scope) onRemoteInvalidate(data.scope);
    } catch {
      /* ignore */
    }
  });
}

/**
 * Call after a successful REST write (`POST` / `PATCH` / `PUT` / `DELETE`).
 * All mounted queries for that resource refetch; other browser tabs do too.
 */
export function notifyDataChanged(scope: DataSyncScope = "all"): void {
  ensureCrossTabListeners();
  void invalidateByScope(scope);
  publishToOtherTabs(scope);
}

/** Wire cross-tab listeners once at app startup (inside QueryClientProvider). */
export function setupDataSyncBridge(): () => void {
  ensureCrossTabListeners();
  return () => {};
}
