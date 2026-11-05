/**
 * On-chain sync — local-first hybrid architecture.
 * ------------------------------------------------------------------
 * Messages are stored locally in IndexedDB for instant UX, and
 * submitted to the Octra chain asynchronously. The sync layer:
 *   1. Submits local messages to the chain
 *   2. Polls transaction status until confirmed
 *   3. Updates local message status (pending → confirmed)
 *   4. Syncs from chain (for multi-device support)
 */

import type { Identity } from "./crypto";
import type { StorageEntry } from "./circle";
import { OctraRpcClient, type OctraNetwork } from "./rpc";
import {
  postCircleMessage,
  readCircleMessages,
  type OnChainMessage,
} from "./circle-contract";
import { decryptGroupEntry } from "./circle";

export type OnChainStatus =
  | "local_only"    // not submitted to chain
  | "submitting"   // transaction signed and sent
  | "pending"      // in mempool, waiting for epoch
  | "confirmed"    // included in a finalized epoch
  | "failed";      // rejected by network

export interface SyncedEntry extends StorageEntry {
  onChainStatus: OnChainStatus;
  txHash?: string;
  confirmedEpoch?: number;
  confirmedAt?: number;
  errorMessage?: string;
}

/**
 * Submit a local message to the chain.
 * Returns immediately with txHash; confirmation happens async.
 */
export async function submitToChain(params: {
  entry: StorageEntry;
  plaintext: string;
  identity: Identity;
  circleAddress: string;
  recipients: { curvePublic: Uint8Array }[];
  network: OctraNetwork;
  customRpcUrl?: string;
}): Promise<{ txHash: string; status: "submitting" }> {
  const { entry, plaintext, identity, circleAddress, recipients, network } = params;

  const result = await postCircleMessage({
    identity,
    circleAddress,
    plaintext,
    recipients,
    network,
    customRpcUrl: params.customRpcUrl,
    replyTo: entry.refId ? parseInt(entry.refId, 10) : undefined,
  });

  return {
    txHash: result.txHash,
    status: "submitting",
  };
}

/**
 * Poll transaction status until confirmed or failed.
 * Octra transactions confirm in ~10-35 seconds (standard) or 2-17 minutes (complex).
 */
export async function pollTxStatus(params: {
  txHash: string;
  rpc: OctraRpcClient;
  timeoutMs?: number;
  pollIntervalMs?: number;
  onStatus?: (status: OnChainStatus, detail?: any) => void;
}): Promise<{
  status: "confirmed" | "failed" | "timeout";
  epoch?: number;
  detail?: any;
}> {
  const { txHash, rpc, onStatus } = params;
  const timeoutMs = params.timeoutMs ?? 20 * 60 * 1000; // 20 min max
  const pollInterval = params.pollIntervalMs ?? 5000; // poll every 5s
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Query transaction status
      const result = await (rpc as any).getTransaction?.(txHash) ||
        await rawRpcCall(rpc, "octra_transaction", [txHash]);

      if (result?.ok || result?.result) {
        const tx = result.result || result;
        const status = tx.status;

        if (status === "confirmed") {
          onStatus?.("confirmed", tx);
          return { status: "confirmed", epoch: tx.epoch, detail: tx };
        }
        if (status === "rejected" || status === "failed" || status === "dropped") {
          onStatus?.("failed", tx);
          return { status: "failed", detail: tx };
        }
        if (status === "pending") {
          onStatus?.("pending", tx);
        }
      }
    } catch (e) {
      // Continue polling on error
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  onStatus?.("timeout" as any);
  return { status: "timeout" };
}

/**
 * Sync local IndexedDB with on-chain circle storage.
 * Fetches all messages from the chain and merges with local state.
 * Used for multi-device sync.
 */
export async function syncFromChain(params: {
  identity: Identity;
  circleAddress: string;
  rpc: OctraRpcClient;
  localEntries: StorageEntry[];
}): Promise<{
  newMessages: OnChainMessage[];
  decryptedTexts: string[];
}> {
  const { identity, circleAddress, rpc, localEntries } = params;

  // Read all on-chain messages
  const onChainMessages = await readCircleMessages({
    rpc,
    circleAddress,
  });

  // Find messages not in local state
  const localHashes = new Set(localEntries.map((e) => e.hash));
  const newMessages = onChainMessages.filter((m) => !localHashes.has(m.txHash || ""));

  // Decrypt new messages
  const decryptedTexts: string[] = [];
  for (const msg of newMessages) {
    // Convert on-chain message to StorageEntry format for decryption
    const fakeEntry: StorageEntry = {
      hash: msg.txHash || `onchain_${msg.id}`,
      circleId: circleAddress,
      author: msg.author,
      authorCurvePub: "", // would need to look up from circle members
      ts: msg.ts * 1000, // on-chain ts is in seconds
      payload: {
        body: msg.body,
        bodyNonce: "", // would need to parse from on-chain format
        wraps: msg.wraps,
      } as any,
      kind: "message",
    };

    const text = decryptGroupEntry(fakeEntry, identity);
    if (text) decryptedTexts.push(text);
  }

  return { newMessages, decryptedTexts };
}

/**
 * Background sync loop — continuously polls and updates status.
 * Call this once per circle when the app is open.
 */
export class BackgroundSync {
  private intervals: Map<string, NodeJS.Timeout> = new Map();

  startSync(circleAddress: string, params: {
    rpc: OctraRpcClient;
    pollIntervalMs?: number;
    onNewMessages?: (msgs: OnChainMessage[]) => void;
  }) {
    if (this.intervals.has(circleAddress)) return;

    const interval = setInterval(async () => {
      try {
        const messages = await readCircleMessages({
          rpc: params.rpc,
          circleAddress,
        });
        if (messages.length > 0) {
          params.onNewMessages?.(messages);
        }
      } catch {
        // Continue on error
      }
    }, params.pollIntervalMs ?? 30000); // poll every 30s

    this.intervals.set(circleAddress, interval);
  }

  stopSync(circleAddress: string) {
    const interval = this.intervals.get(circleAddress);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(circleAddress);
    }
  }

  stopAll() {
    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }
    this.intervals.clear();
  }
}

// ─── Helper ──────────────────────────────────────────────

async function rawRpcCall(rpc: OctraRpcClient, method: string, params: any): Promise<any> {
  const config = (rpc as any).config;
  const url = config?.url ||
    (config?.network === "mainnet"
      ? "https://octra.network/rpc"
      : "https://devnet.octrascan.io/rpc");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
      signal: AbortSignal.timeout(15000),
    });
    const json = await res.json();
    if (json.error) return { error: json.error };
    return { ok: true, result: json.result };
  } catch (e: any) {
    return { error: { message: e.message } };
  }
}
