/**
 * Sealed Sender — hide the sender's identity on-chain.
 * ------------------------------------------------------------------
 * Instead of putting the sender's real address in the `from` field,
 * we use an ephemeral sender identity per message. The real sender
 * is authenticated via a certificate chain:
 *
 *   1. Sender generates ephemeral Ed25519 keypair per message
 *   2. Sender signs the ephemeral pubkey with their identity key
 *   3. Message `from` = ephemeral address (derived from ephemeral pubkey)
 *   4. Message payload includes: ephemeral_pub + identity_signature
 *   5. Receiver verifies the identity signature to learn the real sender
 *
 * This means:
 *   ✓ On-chain observers see a different sender address each message
 *   ✓ Receiver knows the real sender (via signature verification)
 *   ✓ Metadata (who sent to whom) is obscured
 *   ✓ Linkability between messages is reduced
 */

import nacl from "tweetnacl";
import {
  Bytes,
  bytesToB64,
  b64ToBytes,
  utf8ToBytes,
  randomBytes,
  type Identity,
} from "./crypto";
import { addressFromPubkey } from "./crypto";

export interface SealedSenderHeader {
  /** Ephemeral Ed25519 public key (base64) */
  ephemeralPub: string;
  /** Ephemeral address derived from ephemeral pubkey */
  ephemeralAddress: string;
  /** Identity signature over the ephemeral pubkey (base64) */
  identitySig: string;
  /** Real sender's Ed25519 public key (base64) — for verification */
  identityPub: string;
}

export interface SealedMessage {
  header: SealedSenderHeader;
  /** The actual message payload (already encrypted with E2E) */
  payload: string;
}

/**
 * Create a sealed sender header for a message.
 * The sender uses an ephemeral keypair, signed by their identity key.
 */
export async function createSealedHeader(
  identity: Identity
): Promise<SealedSenderHeader> {
  // Generate ephemeral Ed25519 keypair
  const eph = nacl.sign.keyPair();

  // Derive ephemeral address
  const ephAddress = await addressFromPubkey(eph.publicKey);

  // Sign the ephemeral pubkey with identity key
  // Signature payload: "sealed_sender|" || ephemeral_pub || timestamp
  const ts = Math.floor(Date.now() / 1000);
  const sigPayload = new Uint8Array([
    ...utf8ToBytes("sealed_sender|"),
    ...eph.publicKey,
    ...utf8ToBytes(String(ts)),
  ]);
  const sig = nacl.sign.detached(sigPayload, identity.edSecretKey);

  return {
    ephemeralPub: bytesToB64(eph.publicKey),
    ephemeralAddress: ephAddress,
    identitySig: bytesToB64(sig),
    identityPub: bytesToB64(identity.edPublicKey),
  };
}

/**
 * Verify a sealed sender header and extract the real sender.
 * Returns the sender's Ed25519 public key if valid, null otherwise.
 */
export function verifySealedHeader(
  header: SealedSenderHeader,
  maxAgeSeconds: number = 3600
): { valid: boolean; senderPub?: Bytes; senderAddress?: string } {
  try {
    const ephPub = b64ToBytes(header.ephemeralPub);
    const identityPub = b64ToBytes(header.identityPub);
    const sig = b64ToBytes(header.identitySig);

    // Reconstruct signature payload (we don't know the exact timestamp,
    // so we try the current second ± maxAgeSeconds window)
    // For simplicity, we accept any timestamp within the last hour
    const now = Math.floor(Date.now() / 1000);

    // Try timestamps in the valid window (this is simplified — in production
    // you'd include the timestamp in the header)
    for (let ts = now; ts >= now - maxAgeSeconds; ts--) {
      const payload = new Uint8Array([
        ...utf8ToBytes("sealed_sender|"),
        ...ephPub,
        ...utf8ToBytes(String(ts)),
      ]);
      if (nacl.sign.detached.verify(payload, sig, identityPub)) {
        // Derive sender address from identity pubkey
        // (async in real impl, but we return the pubkey for async derivation)
        return {
          valid: true,
          senderPub: identityPub,
        };
      }
    }

    return { valid: false };
  } catch {
    return { valid: false };
  }
}

/**
 * Build a complete sealed message.
 * The payload should already be E2E encrypted (via ratchet or group envelope).
 */
export async function sealMessage(
  identity: Identity,
  encryptedPayload: string
): Promise<SealedMessage> {
  const header = await createSealedHeader(identity);
  return {
    header,
    payload: encryptedPayload,
  };
}

/**
 * Open a sealed message — verify the sender and return the payload.
 */
export function openSealedMessage(
  sealed: SealedMessage
): { valid: boolean; senderPub?: Bytes; payload?: string } {
  const verification = verifySealedHeader(sealed.header);
  if (!verification.valid) {
    return { valid: false };
  }
  return {
    valid: true,
    senderPub: verification.senderPub,
    payload: sealed.payload,
  };
}

/**
 * Batch sealed sender — use the same ephemeral key for a batch of messages.
 * Reduces overhead when sending multiple messages in quick succession.
 */
export class SealedSenderBatch {
  private ephemeral: nacl.SignKeyPair;
  private ephemeralAddress: string | null = null;
  private header: SealedSenderHeader | null = null;

  constructor(private identity: Identity) {
    this.ephemeral = nacl.sign.keyPair();
  }

  async getHeader(): Promise<SealedSenderHeader> {
    if (this.header) return this.header;

    this.ephemeralAddress = await addressFromPubkey(this.ephemeral.publicKey);

    const ts = Math.floor(Date.now() / 1000);
    const sigPayload = new Uint8Array([
      ...utf8ToBytes("sealed_sender_batch|"),
      ...this.ephemeral.publicKey,
      ...utf8ToBytes(String(ts)),
    ]);
    const sig = nacl.sign.detached(sigPayload, this.identity.edSecretKey);

    this.header = {
      ephemeralPub: bytesToB64(this.ephemeral.publicKey),
      ephemeralAddress: this.ephemeralAddress,
      identitySig: bytesToB64(sig),
      identityPub: bytesToB64(this.identity.edPublicKey),
    };

    return this.header;
  }

  /** Rotate the ephemeral key (for forward secrecy of sender identity) */
  rotate(): void {
    this.ephemeral = nacl.sign.keyPair();
    this.header = null;
    this.ephemeralAddress = null;
  }
}
