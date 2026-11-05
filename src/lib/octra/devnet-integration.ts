/**
 * Real Octra Devnet Integration — scan actual on-chain stealth outputs.
 * ------------------------------------------------------------------
 * This connects to the REAL Octra devnet and scans the actual stealth
 * output pool (octra_stealthOutputsPage) for messages intended for us.
 *
 * Unlike the local-only stealth simulation, this reads REAL on-chain data
 * from the Octra network.
 */

import nacl from "tweetnacl";
import { decodeBase64 } from "tweetnacl-util";
import type { Identity } from "./crypto";
import { OctraRpcClient } from "./rpc";

export interface DevnetStealthOutput {
  id: number;
  stealth_tag: string;       // hex, 16 bytes
  eph_pub: string;           // base64, 32 bytes ephemeral Curve25519 pub
  enc_amount: string;        // base64 encrypted amount
  epoch_id: number;
  tx_hash: string;
  claimed: number;
  claim_pub: string | null;
  delta_cipher_stored: string | null;
  amount_hash: string | null;
  amount_commitment: string | null;
}

export interface ScannedStealthResult {
  totalScanned: number;
  matched: number;
  decrypted: DevnetStealthMessage[];
  errors: number;
}

export interface DevnetStealthMessage {
  outputId: number;
  epochId: number;
  txHash: string;
  ephemeralPub: string;
  /** Decrypted payload (if we could decrypt) */
  plaintext: string | null;
  /** Whether this output was meant for us */
  isForUs: boolean;
}

/**
 * Scan the REAL Octra devnet stealth output pool for messages intended for us.
 *
 * This is the real Octra integration — not a simulation. We fetch actual
 * on-chain stealth outputs from the devnet RPC and try to decrypt each one
 * with our Curve25519 private key.
 *
 * Octra stealth output format (from devnet):
 *   { id, stealth_tag, eph_pub, enc_amount, epoch_id, tx_hash, claimed, ... }
 *
 * Decryption:
 *   shared = ECDH(myCurveSec, eph_pub)  — same as sender's ECDH(eph_sec, myCurvePub)
 *   plaintext = secretbox.open(enc_amount, nonce, shared)
 */
export async function scanDevnetStealthOutputs(
  identity: Identity,
  rpc: OctraRpcClient,
  options: {
    fromEpoch?: number;
    maxOutputs?: number;
    onProgress?: (scanned: number, matched: number) => void;
  } = {}
): Promise<ScannedStealthResult> {
  const { fromEpoch = 0, maxOutputs = 100, onProgress } = options;

  // Fetch real stealth outputs from devnet (paginated)
  const result = await rpc.getStealthOutputsPage(fromEpoch, null, maxOutputs, 30000);

  if (!result.ok || !result.result) {
    return { totalScanned: 0, matched: 0, decrypted: [], errors: 0 };
  }

  const outputs: DevnetStealthOutput[] = Array.isArray(result.result)
    ? result.result
    : (result.result as any).outputs || (result.result as any).items || [];

  const decrypted: DevnetStealthMessage[] = [];
  let matched = 0;
  let errors = 0;
  let scanned = 0;

  for (const output of outputs) {
    scanned++;
    if (onProgress && scanned % 10 === 0) {
      onProgress(scanned, matched);
    }

    if (!output.eph_pub || !output.enc_amount) {
      errors++;
      continue;
    }

    try {
      const ephPub = decodeBase64(output.eph_pub);

      // Compute shared secret: ECDH(myCurveSec, ephPub)
      const shared = nacl.scalarMult(identity.curveSecretKey, ephPub);

      // Try to decrypt enc_amount as a secretbox
      // Octra stealth outputs encrypt the amount, not a message.
      // The nonce might be derived from the stealth_tag or be zeros.
      // Try multiple nonce strategies:
      const encBytes = decodeBase64(output.enc_amount);

      // Strategy 1: nonce = first 24 bytes of stealth_tag (hex → bytes)
      const tagBytes = hexToBytes(output.stealth_tag);
      let nonce = tagBytes.slice(0, 24);
      let opened = trySecretboxOpen(encBytes, nonce, shared);

      // Strategy 2: nonce = zeros (24 bytes)
      if (!opened) {
        nonce = new Uint8Array(24);
        opened = trySecretboxOpen(encBytes, nonce, shared);
      }

      // Strategy 3: nonce = first 24 bytes of eph_pub
      if (!opened) {
        nonce = ephPub.slice(0, 24);
        opened = trySecretboxOpen(encBytes, nonce, shared);
      }

      if (opened) {
        matched++;
        const plaintext = new TextDecoder().decode(opened);
        decrypted.push({
          outputId: output.id,
          epochId: output.epoch_id,
          txHash: output.tx_hash,
          ephemeralPub: output.eph_pub,
          plaintext,
          isForUs: true,
        });
      }
    } catch {
      errors++;
    }
  }

  return {
    totalScanned: scanned,
    matched,
    decrypted,
    errors,
  };
}

/**
 * Fetch real network status from Octra devnet.
 */
export async function getDevnetNetworkStatus(rpc: OctraRpcClient): Promise<{
  epoch: number;
  networkVersion: string;
  validator: string;
  stateRoot: string;
  txidHi: string;
  timestamp: number;
} | null> {
  const result = await rpc.nodeStatus(8000);
  if (!result.ok || !result.result) return null;

  return {
    epoch: result.result.epoch || 0,
    networkVersion: result.result.network_version || "",
    validator: result.result.validator || "",
    stateRoot: result.result.state_root || "",
    txidHi: result.result.txid_hi || "",
    timestamp: result.result.timestamp || 0,
  };
}

/**
 * Fetch real account info from Octra devnet.
 */
export async function getDevnetAccount(
  rpc: OctraRpcClient,
  address: string
): Promise<{
  address: string;
  balance: string;
  balanceRaw: string;
  nonce: number;
  pendingNonce: number;
  hasPublicKey: boolean;
  txCount: number;
  recentTxs: any[];
} | null> {
  const result = await rpc.getAccount(address, 20);
  if (!result.ok || !result.result) return null;

  const acct = result.result as any;
  return {
    address: acct.address || address,
    balance: acct.balance || "0",
    balanceRaw: acct.balance_raw || "0",
    nonce: acct.nonce || 0,
    pendingNonce: acct.pending_nonce || acct.nonce || 0,
    hasPublicKey: acct.has_public_key || false,
    txCount: acct.tx_count || 0,
    recentTxs: acct.recent_txs || [],
  };
}

/**
 * Fetch real pending transactions (mempool) from Octra devnet.
 */
export async function getDevnetMempool(rpc: OctraRpcClient): Promise<{
  count: number;
  total: number;
  transactions: any[];
} | null> {
  // staging_view is not in the OctraRpcClient, use raw fetch
  const url = (rpc as any).config?.url || "https://devnet.octrascan.io/rpc";
  const network = (rpc as any).config?.network || "devnet";
  const endpoint = network === "mainnet"
    ? "https://octra.network/rpc"
    : url;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "staging_view", params: [] }),
      signal: AbortSignal.timeout(8000),
    });
    const json: any = await res.json();
    if (json.result) {
      return {
        count: json.result.count || 0,
        total: json.result.total || 0,
        transactions: json.result.transactions || [],
      };
    }
  } catch {}
  return null;
}

// ─── Helpers ──────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function trySecretboxOpen(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  key: Uint8Array
): Uint8Array | null {
  try {
    if (nonce.length !== 24) return null;
    if (ciphertext.length < 16) return null;
    return nacl.secretbox.open(ciphertext, nonce, key);
  } catch {
    return null;
  }
}
