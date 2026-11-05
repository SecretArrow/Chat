/**
 * Safety Numbers — identity verification via fingerprint.
 * ------------------------------------------------------------------
 * Computes a short, human-verifiable fingerprint from both parties'
 * identity keys. Users compare this out-of-band (voice/in-person)
 * to detect man-in-the-middle attacks.
 *
 * Format: 12 groups of 5 digits (60 digits total), like Signal.
 *   Example: "12345 67890 12345 67890 ..."
 */

import {
  Bytes,
  bytesToB64,
  utf8ToBytes,
  type Identity,
} from "./crypto";

async function sha256(data: Bytes): Promise<Bytes> {
  const d = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(d);
}

async function sha512(data: Bytes): Promise<Bytes> {
  const d = await crypto.subtle.digest("SHA-512", data);
  return new Uint8Array(d);
}

/**
 * Compute the safety number for a conversation between two identities.
 *
 * The fingerprint is derived from BOTH parties' Ed25519 + Curve25519 public keys,
 * sorted to ensure both sides compute the same number regardless of who initiates.
 */
export async function computeSafetyNumber(
  myIdentity: Identity,
  theirEdPub: Bytes,
  theirCurvePub: Bytes
): Promise<string> {
  // Sort the two parties' keys so both sides compute the same fingerprint
  const myKeyMaterial = new Uint8Array([
    ...myIdentity.edPublicKey,
    ...myIdentity.curvePublicKey,
  ]);
  const theirKeyMaterial = new Uint8Array([...theirEdPub, ...theirCurvePub]);

  // Lexicographic sort
  const [first, second] = compareBytes(myKeyMaterial, theirKeyMaterial) < 0
    ? [myKeyMaterial, theirKeyMaterial]
    : [theirKeyMaterial, myKeyMaterial];

  // Concatenate + hash (SHA-512 for sufficient entropy, then truncate)
  const combined = new Uint8Array([...first, ...second]);
  const hash = await sha512(combined);

  // Take first 30 bytes → 60 digits in groups of 5
  const digits = new Uint8Array(30);
  digits.set(hash.slice(0, 30));

  // Convert to digit groups
  const groups: string[] = [];
  for (let i = 0; i < 12; i++) {
    const byte = (digits[i * 2] << 8) | digits[i * 2 + 1];
    // 5-digit number (00000–99999), modulo 100000
    const num = byte % 100000;
    groups.push(num.toString().padStart(5, "0"));
  }

  return groups.join(" ");
}

/**
 * Compute a compact safety number (shorter format for UI).
 * Returns 12 hex characters (6 bytes).
 */
export async function computeCompactSafetyNumber(
  myIdentity: Identity,
  theirEdPub: Bytes,
  theirCurvePub: Bytes
): Promise<string> {
  const myKeyMaterial = new Uint8Array([...myIdentity.edPublicKey, ...myIdentity.curvePublicKey]);
  const theirKeyMaterial = new Uint8Array([...theirEdPub, ...theirCurvePub]);

  const [first, second] = compareBytes(myKeyMaterial, theirKeyMaterial) < 0
    ? [myKeyMaterial, theirKeyMaterial]
    : [theirKeyMaterial, myKeyMaterial];

  const combined = new Uint8Array([...first, ...second]);
  const hash = await sha256(combined);

  // Take 6 bytes → 12 hex chars
  return Array.from(hash.slice(0, 6))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * Verify that a safety number matches.
 * Returns true if the computed number equals the expected.
 */
export async function verifySafetyNumber(
  myIdentity: Identity,
  theirEdPub: Bytes,
  theirCurvePub: Bytes,
  expected: string
): Promise<boolean> {
  const computed = await computeSafetyNumber(myIdentity, theirEdPub, theirCurvePub);
  // Constant-time comparison
  return constantTimeStringEqual(computed.replace(/\s/g, ""), expected.replace(/\s/g, ""));
}

/**
 * Get the Ed25519 + Curve25519 public keys for a safety number display.
 * Used to show the user their own keys for out-of-band verification.
 */
export function getMyPublicKeys(identity: Identity): {
  edPubB64: string;
  curvePubEncoded: string;
} {
  return {
    edPubB64: bytesToB64(identity.edPublicKey),
    curvePubEncoded: "cp_" + bytesToB64(identity.curvePublicKey),
  };
}

// ─── Helpers ──────────────────────────────────────────────

function compareBytes(a: Bytes, b: Bytes): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

function constantTimeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
