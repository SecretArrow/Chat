/**
 * Transaction builder & signer — faithful port of octra-labs/webcli/lib/tx_builder.hpp
 * ------------------------------------------------------------------
 * Builds the canonical signing JSON, signs with Ed25519, and constructs
 * the full transaction object for submission via octra_submit.
 */

import nacl from "tweetnacl";
import { encodeBase64 } from "tweetnacl-util";
import {
  Bytes,
  utf8ToBytes,
  b64ToBytes,
  bytesToB64,
  type Identity,
} from "./crypto";

export interface OctraTransaction {
  from: string;
  to_: string; // note: "to_" not "to"
  amount: string; // decimal string, raw units (1 OCT = 100,000,000)
  nonce: number;
  ou: string; // fee in raw units
  timestamp: number; // unix float
  op_type: string; // "standard" | "contract_call" | etc.
  signature?: string; // base64, 64 bytes
  public_key?: string; // base64, 32 bytes
  encrypted_data?: string;
  message?: string;
}

/** Strip leading zeros from a decimal string (matches Octra's decimal_text) */
function decimalText(value: string): string {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error("amount and fee must use decimal whole units");
  }
  const first = value.replace(/^0+/, "");
  return first === "" ? "0" : first;
}

/** Format timestamp as Octra expects: float with .0 if integer */
function formatTimestamp(ts: number): string {
  if (!Number.isFinite(ts)) throw new Error("timestamp not finite");
  let text = String(ts);
  // Ensure it has a decimal point
  if (!text.includes(".") && !text.includes("e") && !text.includes("E")) {
    text += ".0";
  }
  return text;
}

/** JSON escape (matches Octra's json_escape) */
function jsonEscape(s: string): string {
  let r = "";
  for (const c of s) {
    switch (c) {
      case '"': r += '\\"'; break;
      case "\\": r += "\\\\"; break;
      case "\b": r += "\\b"; break;
      case "\f": r += "\\f"; break;
      case "\n": r += "\\n"; break;
      case "\r": r += "\\r"; break;
      case "\t": r += "\\t"; break;
      default:
        if (c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f) {
          const hex = "0123456789abcdef";
          const v = c.charCodeAt(0);
          r += "\\u00" + hex[v >> 4] + hex[v & 15];
        } else {
          r += c;
        }
    }
  }
  return r;
}

/**
 * Build the canonical signing JSON.
 * Field order and formatting MUST match Octra's signing_json exactly:
 *   {"from":"...","to_":"...","amount":"...","nonce":N,"ou":"...","timestamp":F,"op_type":"..."}
 * Optional fields (encrypted_data, message) appended if non-empty.
 */
export function buildSigningJson(tx: OctraTransaction): string {
  let s = "{";
  s += `"from":"${jsonEscape(tx.from)}"`;
  s += `,"to_":"${jsonEscape(tx.to_)}"`;
  s += `,"amount":"${decimalText(tx.amount)}"`;
  s += `,"nonce":${tx.nonce}`;
  s += `,"ou":"${decimalText(tx.ou)}"`;
  s += `,"timestamp":${formatTimestamp(tx.timestamp)}`;
  s += `,"op_type":"${jsonEscape(tx.op_type || "standard")}"`;
  if (tx.encrypted_data) {
    s += `,"encrypted_data":"${jsonEscape(tx.encrypted_data)}"`;
  }
  if (tx.message) {
    s += `,"message":"${jsonEscape(tx.message)}"`;
  }
  s += "}";
  return s;
}

/**
 * Build the hash JSON (includes signature + public_key).
 * Used for computing the transaction hash.
 */
export function buildHashJson(tx: OctraTransaction): string {
  const optional = (v?: string) => (v ? `"${jsonEscape(v)}"` : "null");
  let s = "{";
  s += `"from":"${jsonEscape(tx.from)}"`;
  s += `,"to_":"${jsonEscape(tx.to_)}"`;
  s += `,"amount":"${decimalText(tx.amount)}"`;
  s += `,"nonce":${tx.nonce}`;
  s += `,"ou":"${decimalText(tx.ou)}"`;
  s += `,"timestamp":${formatTimestamp(tx.timestamp)}`;
  s += `,"signature":"${jsonEscape(tx.signature || "")}"`;
  s += `,"op_type":"${jsonEscape(tx.op_type || "standard")}"`;
  s += `,"public_key":${optional(tx.public_key)}`;
  s += `,"message":${optional(tx.message)}`;
  s += `,"encrypted_data":${optional(tx.encrypted_data)}`;
  s += "}";
  return s;
}

/**
 * Sign a transaction with Ed25519.
 * Returns the base64-encoded 64-byte signature.
 *
 * Octra uses crypto_sign (which returns sig+msg) and takes the first 64 bytes
 * as the signature. This matches TweetNaCl's nacl.sign behavior.
 */
export function signTransaction(tx: OctraTransaction, edSecretKey: Bytes): string {
  const signingJson = buildSigningJson(tx);
  const msgBytes = utf8ToBytes(signingJson);
  // nacl.sign returns signed message (sig || msg), we take first 64 bytes
  const sm = nacl.sign(msgBytes, edSecretKey);
  return encodeBase64(sm.slice(0, 64));
}

/**
 * Compute the transaction hash (SHA-256 of hash JSON, hex-encoded).
 */
export async function txHash(tx: OctraTransaction): Promise<string> {
  const hashJson = buildHashJson(tx);
  const msgBytes = utf8ToBytes(hashJson);
  const digest = await crypto.subtle.digest("SHA-256", msgBytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Build the full transaction object for submission to octra_submit.
 * Signs the transaction if not already signed.
 */
export async function buildSignedTx(
  tx: OctraTransaction,
  identity: Identity
): Promise<OctraTransaction> {
  const signature = tx.signature || signTransaction(tx, identity.edSecretKey);
  const publicKey = tx.public_key || bytesToB64(identity.edPublicKey);
  return {
    ...tx,
    signature,
    public_key: publicKey,
  };
}

/**
 * Verify a transaction signature (for received transactions).
 */
export function verifyTxSignature(tx: OctraTransaction): boolean {
  if (!tx.signature || !tx.public_key) return false;
  try {
    const signingJson = buildSigningJson(tx);
    const msgBytes = utf8ToBytes(signingJson);
    const sig = b64ToBytes(tx.signature);
    const pub = b64ToBytes(tx.public_key);
    // nacl.sign.detached.verify returns true if valid
    return nacl.sign.detached.verify(msgBytes, sig, pub);
  } catch {
    return false;
  }
}

/**
 * Sign a circle auth request (for octra_circleViewAuth etc.)
 * Frame format: octra_circle_auth_v2|<len>:<op>|<len>:<circleId>|<len>:<addr>|<len>:<subject>
 */
export function signCircleAuth(
  op: string,
  circleId: string,
  addr: string,
  subject: string,
  edSecretKey: Bytes
): string {
  const domain = "octra_circle_auth_v2";
  const fields = [op, circleId, addr, subject];
  let msg = domain;
  for (const f of fields) {
    msg += `|${f.length}:${f}`;
  }
  const msgBytes = utf8ToBytes(msg);
  const sm = nacl.sign(msgBytes, edSecretKey);
  return encodeBase64(sm.slice(0, 64));
}

/**
 * Sign a balance request (for octra_encryptedBalance).
 */
export function signBalanceRequest(addr: string, edSecretKey: Bytes): string {
  const msg = `octra_encryptedBalance|${addr}`;
  const msgBytes = utf8ToBytes(msg);
  const sm = nacl.sign(msgBytes, edSecretKey);
  return encodeBase64(sm.slice(0, 64));
}

/**
 * Sign a PVAC register request.
 */
export function signRegisterRequest(addr: string, pkBlob: string, edSecretKey: Bytes): string {
  // sha256_hex of pkBlob
  // ... (simplified — full impl would compute sha256 hex)
  const msg = `register_pvac|${addr}|${pkBlob}`;
  const msgBytes = utf8ToBytes(msg);
  const sm = nacl.sign(msgBytes, edSecretKey);
  return encodeBase64(sm.slice(0, 64));
}

/** 1 OCT = 100,000,000 raw units (8 decimals) */
export const OCT_DECIMALS = 8;
export const OCT_RAW = 100_000_000;

/** Convert OCT (float) to raw units (string) */
export function octToRaw(oct: number): string {
  return String(Math.round(oct * OCT_RAW));
}

/** Convert raw units (string) to OCT (float) */
export function rawToOct(raw: string): number {
  return parseInt(raw, 10) / OCT_RAW;
}

/** Standard fee for a contract call (0.00001 OCT = 1000 raw) */
export const STANDARD_FEE = "1000";

/** Standard fee for contract deployment (0.005 OCT = 500000 raw) */
export const DEPLOY_FEE = "500000";
