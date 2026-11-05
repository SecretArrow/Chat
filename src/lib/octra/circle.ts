/**
 * Circle Protocol — OctraChat client-side implementation
 * ------------------------------------------------------------------
 * Mirrors the Octra Circle primitive exposed by lite_node's
 * `circle_runtime/` and the webcli's circle_* RPC methods:
 *
 *   - circle_info / circle_view
 *   - circle members (slot, role)
 *   - circle storage (append-only log)
 *   - circle outbox (pending deliveries)
 *   - circle transport (cross-circle messaging)
 *
 * In a full Octra deployment, these state transitions would be
 * submitted as transactions to the network and finalized by validators.
 * For the browser, we keep a faithful local model so the UX and the
 * cryptographic envelope are identical — only the consensus layer
 * differs. The persistence layer (`./db`) plays the role of the chain.
 */

import nacl from "tweetnacl";
import {
  Bytes,
  bytesToB64,
  b64ToBytes,
  utf8ToBytes,
  randomBytes,
  sha256Async,
  signBytes,
  verifySignature,
  precomputeSharedKey,
  encryptMessage,
  decryptMessage,
  encryptGroupMessage,
  decryptGroupMessage,
  deriveCircleId,
  deriveRoomId,
  encodeCurvePub,
  decodeCurvePub,
  type Identity,
  type EncryptedPayload,
  type GroupEnvelope,
} from "./crypto";

export type CircleKind = "dm" | "room" | "group";
export type MemberRole = "admin" | "member" | "viewer";

export interface CircleMember {
  address: string;
  curvePub: string; // encoded Curve25519 pub (cp_...)
  role: MemberRole;
  joinedAt: number;
  invitedBy: string;
  slotIndex: number;
  signature?: string; // signed membership statement by the member
}

export interface CircleSlot {
  index: number;
  role: MemberRole;
  holderAddress: string | null;
  permissions: string[];
}

export interface StorageEntry {
  /** SHA-256 of (author || ts || payload) */
  hash: string;
  circleId: string;
  author: string; // oct address
  authorCurvePub: string;
  ts: number;
  /** Encrypted payload — DM: EncryptedPayload; Group: GroupEnvelope; Room: EncryptedPayload (with public key) */
  payload: EncryptedPayload | GroupEnvelope;
  /** Optional plaintext signature (Ed25519) over the hash, proving authorship */
  authorSig?: string;
  kind: "message" | "system" | "poll_open" | "poll_vote" | "poll_close";
  refId?: string;
}

export interface OutboxItem {
  id: string;
  circleId: string;
  target: string; // address or circle id
  payload: string; // serialized
  attempts: number;
  status: "pending" | "delivered" | "failed";
  createdAt: number;
}

export interface TransportMessage {
  id: string;
  fromCircle: string;
  toCircle: string;
  payload: string;
  signature: string;
  ts: number;
}

export interface Circle {
  id: string;
  name: string;
  kind: CircleKind;
  createdAt: number;
  createdBy: string;
  members: CircleMember[];
  slots: CircleSlot[];
  description?: string;
  // Room-only: a shared Curve25519 keypair for public rooms (anyone can read)
  roomCurvePub?: string;
  // Group-only: admins hold the group key; members' curve pubs are public
  // Polls: stored separately in db
  lastActivity: number;
  // Transport: list of connected circles for cross-circle relay
  transports: string[];
}

// ----- Circle factory / membership operations -------------------------- //

export async function createDMCircle(
  me: Identity,
  other: { address: string; curvePub: Bytes }
): Promise<{ circle: Circle; sharedKey: Bytes }> {
  const myCurve = me.curvePublicKey;
  const theirCurve = other.curvePub;
  const id = await deriveCircleId([myCurve, theirCurve]);

  const meMember: CircleMember = {
    address: me.address,
    curvePub: encodeCurvePub(myCurve),
    role: "member",
    joinedAt: Date.now(),
    invitedBy: me.address,
    slotIndex: 0,
  };
  const otherMember: CircleMember = {
    address: other.address,
    curvePub: encodeCurvePub(theirCurve),
    role: "member",
    joinedAt: Date.now(),
    invitedBy: me.address,
    slotIndex: 1,
  };

  const circle: Circle = {
    id,
    name: `DM with ${other.address.slice(0, 12)}…`,
    kind: "dm",
    createdAt: Date.now(),
    createdBy: me.address,
    members: [meMember, otherMember],
    slots: [
      { index: 0, role: "member", holderAddress: me.address, permissions: ["read", "write"] },
      { index: 1, role: "member", holderAddress: other.address, permissions: ["read", "write"] },
    ],
    lastActivity: Date.now(),
    transports: [],
  };

  const sharedKey = precomputeSharedKey(me.curveSecretKey, theirCurve);
  return { circle, sharedKey };
}

export async function createRoomCircle(
  me: Identity,
  name: string,
  description?: string
): Promise<Circle> {
  // For rooms, generate an ephemeral shared Curve keypair that anyone can use
  // to encrypt/decrypt messages (public room). Admin retains the right to rotate.
  const roomKey = naclBoxKeyPair();
  const roomCurvePub = roomKey.publicKey;

  // The room key itself is published; messages are sealed with secretbox
  // using sha256(roomCurvePub) as the shared key. This is intentionally
  // public-room behavior; private groups use group envelopes instead.
  const id = await deriveRoomId(name, roomCurvePub);

  const meMember: CircleMember = {
    address: me.address,
    curvePub: encodeCurvePub(me.curvePublicKey),
    role: "admin",
    joinedAt: Date.now(),
    invitedBy: me.address,
    slotIndex: 0,
  };

  const circle: Circle = {
    id,
    name,
    kind: "room",
    createdAt: Date.now(),
    createdBy: me.address,
    members: [meMember],
    slots: [
      { index: 0, role: "admin", holderAddress: me.address, permissions: ["read", "write", "manage"] },
    ],
    description,
    roomCurvePub: encodeCurvePub(roomCurvePub),
    lastActivity: Date.now(),
    transports: [],
  };

  return circle;
}

export async function createGroupCircle(
  me: Identity,
  name: string,
  description?: string
): Promise<Circle> {
  // Groups are private: every message is wrapped per-recipient.
  // Group id derived from creator + name + random salt.
  const salt = randomBytes(16);
  const id = await deriveRoomId("group:" + name, salt);

  const meMember: CircleMember = {
    address: me.address,
    curvePub: encodeCurvePub(me.curvePublicKey),
    role: "admin",
    joinedAt: Date.now(),
    invitedBy: me.address,
    slotIndex: 0,
  };

  const circle: Circle = {
    id,
    name,
    kind: "group",
    createdAt: Date.now(),
    createdBy: me.address,
    members: [meMember],
    slots: [
      { index: 0, role: "admin", holderAddress: me.address, permissions: ["read", "write", "manage", "invite"] },
    ],
    description,
    lastActivity: Date.now(),
    transports: [],
  };

  return circle;
}

// ----- Storage operations --------------------------------------------- //

export async function postDMMessage(
  circle: Circle,
  me: Identity,
  sharedKey: Bytes,
  text: string,
  kind: StorageEntry["kind"] = "message"
): Promise<StorageEntry> {
  const payload = encryptMessage(text, sharedKey);
  const ts = Date.now();
  const authorCurvePub = encodeCurvePub(me.curvePublicKey);

  // Hash for ordering / integrity
  const hashInput = utf8ToBytes(circle.id + "|" + me.address + "|" + ts + "|" + payload.c + "|" + payload.n);
  const h = await sha256Async(hashInput);
  const hash = bytesToB64(h);

  // Author signs the hash so other members can prove authorship
  const authorSig = bytesToB64(signBytes(b64ToBytes(hash), me.edSecretKey));

  return {
    hash,
    circleId: circle.id,
    author: me.address,
    authorCurvePub,
    ts,
    payload,
    authorSig,
    kind,
  };
}

export function decryptDMMessage(
  entry: StorageEntry,
  sharedKey: Bytes
): { text: string; verified: boolean } | null {
  if (!("c" in entry.payload)) return null;
  const text = decryptMessage(entry.payload as EncryptedPayload, sharedKey);
  if (text === null) return null;
  // Verification happens at the call site where we have the author pubkey
  return { text, verified: false };
}

export async function verifyEntryAuthor(
  entry: StorageEntry,
  authorEdPub: Bytes
): Promise<boolean> {
  if (!entry.authorSig) return false;
  try {
    return verifySignature(b64ToBytes(entry.authorSig), b64ToBytes(entry.hash), authorEdPub);
  } catch {
    return false;
  }
}

export async function postGroupMessage(
  circle: Circle,
  me: Identity,
  text: string,
  kind: StorageEntry["kind"] = "message"
): Promise<StorageEntry | null> {
  if (circle.members.length === 0) return null;
  const recipients = circle.members.map((m) => ({ curvePublic: decodeCurvePub(m.curvePub) }));
  const payload = encryptGroupMessage(text, recipients);
  const ts = Date.now();
  const authorCurvePub = encodeCurvePub(me.curvePublicKey);

  const hashInput = utf8ToBytes(circle.id + "|" + me.address + "|" + ts + "|" + payload.body);
  const h = await sha256Async(hashInput);
  const hash = bytesToB64(h);
  const authorSig = bytesToB64(signBytes(b64ToBytes(hash), me.edSecretKey));

  return {
    hash,
    circleId: circle.id,
    author: me.address,
    authorCurvePub,
    ts,
    payload,
    authorSig,
    kind,
  };
}

export function decryptGroupEntry(
  entry: StorageEntry,
  me: Identity
): string | null {
  if (!("body" in entry.payload)) return null;
  return decryptGroupMessage(entry.payload as GroupEnvelope, me.curveSecretKey, me.curvePublicKey);
}

/** Room messages: encrypted with a symmetric key derived from the room's Curve pub */
export async function postRoomMessage(
  circle: Circle,
  me: Identity,
  text: string,
  kind: StorageEntry["kind"] = "message"
): Promise<StorageEntry | null> {
  if (!circle.roomCurvePub) return null;
  const roomCurvePub = decodeCurvePub(circle.roomCurvePub);
  // For public rooms, anyone can derive the same symmetric key from
  // the room's curve public — but ECDH requires a secret. We use
  // sha256(roomCurvePub) as a public shared key (room is intentionally public).
  const sharedKey = await sha256Async(roomCurvePub);
  const payload = encryptMessage(text, sharedKey);
  const ts = Date.now();
  const authorCurvePub = encodeCurvePub(me.curvePublicKey);

  const hashInput = utf8ToBytes(circle.id + "|" + me.address + "|" + ts + "|" + payload.c);
  const h = await sha256Async(hashInput);
  const hash = bytesToB64(h);
  const authorSig = bytesToB64(signBytes(b64ToBytes(hash), me.edSecretKey));

  return {
    hash,
    circleId: circle.id,
    author: me.address,
    authorCurvePub,
    ts,
    payload,
    authorSig,
    kind,
  };
}

export async function decryptRoomEntry(
  entry: StorageEntry,
  circle: Circle
): Promise<string | null> {
  if (!circle.roomCurvePub) return null;
  if (!("c" in entry.payload)) return null;
  const roomCurvePub = decodeCurvePub(circle.roomCurvePub);
  const sharedKey = await sha256Async(roomCurvePub);
  return decryptMessage(entry.payload as EncryptedPayload, sharedKey);
}

// ----- Membership ops -------------------------------------------------- //

export function joinCircle(
  circle: Circle,
  member: CircleMember
): Circle {
  if (circle.members.some((m) => m.address === member.address)) return circle;
  const slotIndex = circle.slots.length;
  const newMember: CircleMember = { ...member, slotIndex };
  const slot: CircleSlot = {
    index: slotIndex,
    role: "member",
    holderAddress: member.address,
    permissions: ["read", "write"],
  };
  return {
    ...circle,
    members: [...circle.members, newMember],
    slots: [...circle.slots, slot],
    lastActivity: Date.now(),
  };
}

export function leaveCircle(circle: Circle, address: string): Circle {
  return {
    ...circle,
    members: circle.members.filter((m) => m.address !== address),
    slots: circle.slots.map((s) =>
      s.holderAddress === address ? { ...s, holderAddress: null } : s
    ),
    lastActivity: Date.now(),
  };
}

export function promoteMember(circle: Circle, address: string, role: MemberRole): Circle {
  return {
    ...circle,
    members: circle.members.map((m) =>
      m.address === address ? { ...m, role } : m
    ),
    slots: circle.slots.map((s) =>
      s.holderAddress === address ? { ...s, role } : s
    ),
    lastActivity: Date.now(),
  };
}

// ----- Transport -------------------------------------------------------- //

export function pushTransport(
  circle: Circle,
  msg: TransportMessage
): Circle {
  return {
    ...circle,
    transports: [...circle.transports, msg.id],
    lastActivity: Date.now(),
  };
}

// ----- Helpers --------------------------------------------------------- //

function naclBoxKeyPair() {
  return nacl.box.keyPair();
}
