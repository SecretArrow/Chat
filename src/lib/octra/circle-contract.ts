/**
 * Circle contract interaction — deploy, join, post message, read storage.
 * ------------------------------------------------------------------
 * Uses tx-builder.ts for signing and rpc.ts for submission/queries.
 */

import {
  Bytes,
  bytesToB64,
  utf8ToBytes,
  randomBytes,
  type Identity,
  encodeCurvePub,
  decodeCurvePub,
} from "./crypto";
import {
  type OctraTransaction,
  buildSignedTx,
  txHash,
  signCircleAuth,
  STANDARD_FEE,
  DEPLOY_FEE,
  octToRaw,
} from "./tx-builder";
import { OctraRpcClient, type OctraNetwork } from "./rpc";
import { encryptGroupMessage, type GroupEnvelope } from "./crypto";

export interface CircleDeployment {
  circleAddress: string;
  txHash: string;
  name: string;
  kind: string;
}

export interface OnChainMessage {
  id: number;
  author: string;
  body: string; // base64 ciphertext
  wraps: Record<string, string>; // address → wrapped key
  ts: number;
  replyTo?: number;
  txHash?: string;
}

export interface CircleMember {
  address: string;
  curvePub: string; // cp_... encoded
  joinedAt: number;
  role: string;
}

export interface CircleInfo {
  address: string;
  name: string;
  description: string;
  kind: string;
  memberCount: number;
  messageCount: number;
  createdAt: number;
  createdBy: string;
}

/**
 * Deploy a ChatCircle contract.
 * Requires a funded wallet (deployment fee ~0.005 OCT).
 */
export async function deployCircle(params: {
  identity: Identity;
  bytecodeB64: string;
  name: string;
  description: string;
  kind: "room" | "group" | "dm";
  network: OctraNetwork;
  customRpcUrl?: string;
}): Promise<CircleDeployment> {
  const { identity, bytecodeB64, name, description, kind } = params;

  // Compute the circle address before deployment
  const rpc = new OctraRpcClient({
    network: params.network,
    url: params.customRpcUrl,
  });

  // Get current nonce
  const balanceResult = await rpc.getBalance(identity.address);
  const nonce = balanceResult.ok && balanceResult.result
    ? 0 // nonce comes from balance result in real impl
    : 0;

  // Compute contract address via RPC
  const computeResult = await rpcCallRaw(rpc, "octra_computeContractAddress", [
    bytecodeB64,
    identity.address,
    nonce,
  ]);

  const circleAddress = computeResult?.result?.address || computeResult?.result || "";

  // Build deploy transaction
  const deployTx: OctraTransaction = {
    from: identity.address,
    to_: identity.address, // self for deploy
    amount: "0",
    nonce,
    ou: DEPLOY_FEE,
    timestamp: Date.now() / 1000,
    op_type: "deploy",
    message: bytecodeB64, // bytecode in message field
  };

  const signedTx = await buildSignedTx(deployTx, identity);
  const hash = await txHash(signedTx);

  // Submit
  const submitResult = await rpcCallRaw(rpc, "octra_submit", [signedTx]);
  if (submitResult?.error) {
    throw new Error(`Deploy failed: ${submitResult.error.message}`);
  }

  return {
    circleAddress,
    txHash: hash,
    name,
    kind,
  };
}

/**
 * Join an existing circle.
 * Anyone can join (open membership per the AML contract).
 */
export async function joinCircle(params: {
  identity: Identity;
  circleAddress: string;
  network: OctraNetwork;
  customRpcUrl?: string;
}): Promise<{ txHash: string }> {
  const { identity, circleAddress } = params;
  const rpc = new OctraRpcClient({
    network: params.network,
    url: params.customRpcUrl,
  });

  // Get nonce
  const balRes = await rpc.getBalance(identity.address);
  const nonce = (balRes.result as any)?.nonce || 0;

  const curvePubEncoded = encodeCurvePub(identity.curvePublicKey);

  // Build contract_call transaction
  const joinTx: OctraTransaction = {
    from: identity.address,
    to_: circleAddress,
    amount: "0",
    nonce,
    ou: STANDARD_FEE,
    timestamp: Date.now() / 1000,
    op_type: "contract_call",
    message: JSON.stringify({
      method: "join",
      params: { curve_pub: curvePubEncoded },
    }),
  };

  const signedTx = await buildSignedTx(joinTx, identity);
  const hash = await txHash(signedTx);

  const submitResult = await rpcCallRaw(rpc, "octra_submit", [signedTx]);
  if (submitResult?.error) {
    throw new Error(`Join failed: ${submitResult.error.message}`);
  }

  return { txHash: hash };
}

/**
 * Post an encrypted message to a circle.
 * The plaintext is encrypted client-side with per-recipient envelopes,
 * then submitted as a contract_call transaction.
 */
export async function postCircleMessage(params: {
  identity: Identity;
  circleAddress: string;
  plaintext: string;
  recipients: { curvePublic: Bytes }[];
  network: OctraNetwork;
  customRpcUrl?: string;
  replyTo?: number;
}): Promise<{
  txHash: string;
  envelope: GroupEnvelope;
  bodyB64: string;
  wrapsB64: Record<string, string>;
}> {
  const { identity, circleAddress, plaintext, recipients, replyTo } = params;
  const rpc = new OctraRpcClient({
    network: params.network,
    url: params.customRpcUrl,
  });

  // Encrypt with per-recipient envelopes
  const envelope = encryptGroupMessage(plaintext, recipients);

  // Convert wraps to address→wrapped format for on-chain storage
  // (on chain, wraps are keyed by recipient address, not curve pub)
  // For now, we store wraps keyed by curve pub encoding
  const wrapsB64: Record<string, string> = {};
  for (const [cpKey, wrap] of Object.entries(envelope.wraps)) {
    wrapsB64[cpKey] = `${wrap.k}|${wrap.n}`;
  }

  // Get nonce
  const balRes = await rpc.getBalance(identity.address);
  const nonce = (balRes.result as any)?.nonce || 0;

  // Build contract_call transaction
  const postTx: OctraTransaction = {
    from: identity.address,
    to_: circleAddress,
    amount: "0",
    nonce,
    ou: STANDARD_FEE,
    timestamp: Date.now() / 1000,
    op_type: "contract_call",
    message: JSON.stringify({
      method: "post_message",
      params: {
        body: envelope.body,
        body_nonce: envelope.bodyNonce,
        wraps: wrapsB64,
        reply_to: replyTo ?? null,
      },
    }),
  };

  const signedTx = await buildSignedTx(postTx, identity);
  const hash = await txHash(signedTx);

  const submitResult = await rpcCallRaw(rpc, "octra_submit", [signedTx]);
  if (submitResult?.error) {
    throw new Error(`Post failed: ${submitResult.error.message}`);
  }

  return {
    txHash: hash,
    envelope,
    bodyB64: envelope.body,
    wrapsB64,
  };
}

/**
 * Read all messages from a circle's on-chain storage.
 * Uses octra_circleStorageDump (free, read-only).
 */
export async function readCircleMessages(params: {
  rpc: OctraRpcClient;
  circleAddress: string;
}): Promise<OnChainMessage[]> {
  const { rpc, circleAddress } = params;

  // Try storage dump first (gets all keys)
  const dumpResult = await rpc.circleStorageDump(circleAddress);
  if (dumpResult.ok && dumpResult.result) {
    const storage = dumpResult.result as any;
    const messages: OnChainMessage[] = [];

    // Parse messages from storage
    if (Array.isArray(storage)) {
      for (const entry of storage) {
        const msg = parseOnChainMessage(entry);
        if (msg) messages.push(msg);
      }
    } else if (typeof storage === "object") {
      for (const [key, value] of Object.entries(storage)) {
        if (key.startsWith("msg_")) {
          const msg = parseOnChainMessage(value);
          if (msg) messages.push(msg);
        }
      }
    }

    return messages.sort((a, b) => a.id - b.id);
  }

  return [];
}

/**
 * Get circle info via octra_circleView (read-only).
 */
export async function getCircleInfo(params: {
  rpc: OctraRpcClient;
  circleAddress: string;
}): Promise<CircleInfo | null> {
  const { rpc, circleAddress } = params;

  // Try circle_info first
  const infoResult = await rpc.circleInfo(circleAddress);
  if (infoResult.ok && infoResult.result) {
    const info = infoResult.result as any;
    return {
      address: circleAddress,
      name: info.name || info.meta?.name || "",
      description: info.description || info.meta?.description || "",
      kind: info.kind || info.meta?.kind || "group",
      memberCount: info.member_count || info.members?.length || 0,
      messageCount: info.message_count || info.next_msg_id || 0,
      createdAt: info.created_at || info.meta?.created_at || 0,
      createdBy: info.created_by || info.meta?.created_by || "",
    };
  }

  return null;
}

/**
 * Get circle members via octra_circleObjectMembers.
 */
export async function getCircleMembers(params: {
  rpc: OctraRpcClient;
  circleAddress: string;
}): Promise<CircleMember[]> {
  const { rpc, circleAddress } = params;

  // Try with "members" as object_ref
  const membersResult = await rpc.circleObjectMembers(circleAddress, "members");
  if (membersResult.ok && membersResult.result) {
    const data = membersResult.result as any;
    const members: CircleMember[] = [];
    const arr = Array.isArray(data) ? data : data.members || [];
    for (const m of arr) {
      members.push({
        address: m.address || m.addr,
        curvePub: m.curve_pub || m.curvePub || "",
        joinedAt: m.joined_at || m.joinedAt || 0,
        role: m.role || "member",
      });
    }
    return members;
  }

  return [];
}

/**
 * Authenticated circle view (requires signature).
 */
export async function circleViewAuth(params: {
  identity: Identity;
  rpc: OctraRpcClient;
  circleAddress: string;
  method: string;
  viewParams: any;
  includeStorage?: boolean;
}): Promise<any> {
  const { identity, rpc, circleAddress, method, viewParams, includeStorage = false } = params;

  // Sign the auth request
  const sig = signCircleAuth(
    "circleViewAuth",
    circleAddress,
    identity.address,
    method,
    identity.edSecretKey
  );

  // Use raw RPC call for the auth method
  const result = await rpcCallRaw(rpc, "octra_circleViewAuth", [
    circleAddress,
    method,
    viewParams,
    identity.address,
    bytesToB64(identity.edPublicKey),
    sig,
    includeStorage,
  ]);

  return result?.result ?? null;
}

// ─── Helpers ──────────────────────────────────────────────

function parseOnChainMessage(raw: any): OnChainMessage | null {
  if (!raw) return null;
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      id: obj.id || 0,
      author: obj.author || obj.from || "",
      body: obj.body || "",
      wraps: obj.wraps || {},
      ts: obj.ts || 0,
      replyTo: obj.reply_to ?? obj.replyTo,
      txHash: obj.tx_hash || obj.txHash,
    };
  } catch {
    return null;
  }
}

async function rpcCallRaw(
  rpc: OctraRpcClient,
  method: string,
  params: any,
  timeoutMs = 15000
): Promise<any> {
  const url = (rpc as any).config?.url || "https://devnet.octrascan.io/rpc";
  const network = (rpc as any).config?.network || "devnet";

  const endpoint =
    network === "mainnet"
      ? "https://octra.network/rpc"
      : network === "devnet"
        ? "https://devnet.octrascan.io/rpc"
        : url;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return await res.json();
  } catch (e: any) {
    return { error: { message: e.message } };
  }
}
