/**
 * IndexedDB persistence — local "chain" for OctraChat
 * ------------------------------------------------------------------
 * Stores encrypted wallet, contacts, circles, storage entries,
 * stealth outputs, and FHE-encrypted polls.
 *
 * Everything written here is what would normally be replicated by the
 * Octra network. We keep it client-side so the app is fully functional
 * offline; the same crypto envelopes could be submitted to a real
 * Octra Circle as-is.
 */

import { openDB, type IDBPDatabase } from "idb";
import type {
  Circle,
  StorageEntry,
  OutboxItem,
  TransportMessage,
} from "./circle";
import type { StealthOutput } from "./stealth";
import type { PaillierPublicKey, PaillierPrivateKey, PaillierCiphertext } from "./fhe";
import type { EncryptedBlob } from "./crypto";

const DB_NAME = "octrachat";
const DB_VERSION = 1;

export interface WalletRecord {
  id: string; // = address
  address: string;
  encryptedBlob: EncryptedBlob; // PIN-encrypted JSON containing mnemonic + edSeed
  createdAt: number;
  label: string;
  isDefault: boolean;
}

export interface ContactRecord {
  id: string; // = address
  address: string;
  nickname: string;
  curvePub: string; // cp_...
  addedAt: number;
  note?: string;
  avatarColor?: string;
}

export interface PollRecord {
  id: string;
  circleId: string;
  question: string;
  options: string[];
  pub: PaillierPublicKey;
  priv?: PaillierPrivateKey; // present on the creator's machine only
  votes: Record<string, PaillierCiphertext>; // voterAddress -> ciphertext
  createdAt: number;
  closedAt?: number;
  tally?: number[];
}

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB() {
  if (typeof window === "undefined") {
    throw new Error("IndexedDB not available during SSR");
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("wallets")) {
          const s = db.createObjectStore("wallets", { keyPath: "id" });
          s.createIndex("address", "address");
        }
        if (!db.objectStoreNames.contains("contacts")) {
          const s = db.createObjectStore("contacts", { keyPath: "id" });
          s.createIndex("address", "address");
        }
        if (!db.objectStoreNames.contains("circles")) {
          const s = db.createObjectStore("circles", { keyPath: "id" });
          s.createIndex("kind", "kind");
          s.createIndex("createdAt", "createdAt");
        }
        if (!db.objectStoreNames.contains("entries")) {
          const s = db.createObjectStore("entries", { keyPath: "hash" });
          s.createIndex("circleId", "circleId");
          s.createIndex("ts", "ts");
          s.createIndex("circleId_ts", ["circleId", "ts"]);
        }
        if (!db.objectStoreNames.contains("outbox")) {
          const s = db.createObjectStore("outbox", { keyPath: "id" });
          s.createIndex("circleId", "circleId");
          s.createIndex("status", "status");
        }
        if (!db.objectStoreNames.contains("transports")) {
          const s = db.createObjectStore("transports", { keyPath: "id" });
          s.createIndex("toCircle", "toCircle");
        }
        if (!db.objectStoreNames.contains("stealth")) {
          const s = db.createObjectStore("stealth", { keyPath: ["ephPub", "ts"] });
          s.createIndex("tag", "tag");
          s.createIndex("ts", "ts");
        }
        if (!db.objectStoreNames.contains("polls")) {
          const s = db.createObjectStore("polls", { keyPath: "id" });
          s.createIndex("circleId", "circleId");
        }
        if (!db.objectStoreNames.contains("kv")) {
          db.createObjectStore("kv");
        }
      },
    });
  }
  return dbPromise;
}

// --- Wallets -------------------------------------------------------- //

export async function saveWallet(rec: WalletRecord): Promise<void> {
  const db = await getDB();
  await db.put("wallets", rec);
}

export async function getWallet(id: string): Promise<WalletRecord | undefined> {
  const db = await getDB();
  return db.get("wallets", id);
}

export async function getDefaultWallet(): Promise<WalletRecord | undefined> {
  const db = await getDB();
  const all = (await db.getAll("wallets")) as WalletRecord[];
  return all.find((w) => w.isDefault) ?? all[0];
}

export async function listWallets(): Promise<WalletRecord[]> {
  const db = await getDB();
  return (await db.getAll("wallets")) as WalletRecord[];
}

export async function deleteWallet(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("wallets", id);
}

// --- Contacts ------------------------------------------------------- //

export async function saveContact(rec: ContactRecord): Promise<void> {
  const db = await getDB();
  await db.put("contacts", rec);
}

export async function getContact(id: string): Promise<ContactRecord | undefined> {
  const db = await getDB();
  return db.get("contacts", id);
}

export async function getContactByAddress(addr: string): Promise<ContactRecord | undefined> {
  const db = await getDB();
  return db.getFromIndex("contacts", "address", addr);
}

export async function listContacts(): Promise<ContactRecord[]> {
  const db = await getDB();
  return (await db.getAll("contacts")) as ContactRecord[];
}

export async function deleteContact(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("contacts", id);
}

// --- Circles -------------------------------------------------------- //

export async function saveCircle(circle: Circle): Promise<void> {
  const db = await getDB();
  await db.put("circles", circle);
}

export async function getCircle(id: string): Promise<Circle | undefined> {
  const db = await getDB();
  return db.get("circles", id);
}

export async function listCircles(): Promise<Circle[]> {
  const db = await getDB();
  return (await db.getAll("circles")) as Circle[];
}

export async function deleteCircle(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("circles", id);
  // Cascade entries
  const tx = db.transaction("entries", "readwrite");
  const idx = tx.store.index("circleId");
  let cursor = await idx.openCursor(id);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

// --- Storage entries ------------------------------------------------ //

export async function appendEntry(entry: StorageEntry): Promise<void> {
  const db = await getDB();
  await db.put("entries", entry);
}

export async function listEntries(circleId: string): Promise<StorageEntry[]> {
  const db = await getDB();
  const idx = db.transaction("entries").store.index("circleId");
  const all = (await idx.getAll(circleId)) as StorageEntry[];
  return all.sort((a, b) => a.ts - b.ts);
}

export async function getEntry(hash: string): Promise<StorageEntry | undefined> {
  const db = await getDB();
  return db.get("entries", hash);
}

// --- Outbox --------------------------------------------------------- //

export async function pushOutbox(item: OutboxItem): Promise<void> {
  const db = await getDB();
  await db.put("outbox", item);
}

export async function listOutbox(circleId?: string): Promise<OutboxItem[]> {
  const db = await getDB();
  if (circleId) {
    return (await db.getAllFromIndex("outbox", "circleId", circleId)) as OutboxItem[];
  }
  return (await db.getAll("outbox")) as OutboxItem[];
}

export async function updateOutbox(item: OutboxItem): Promise<void> {
  const db = await getDB();
  await db.put("outbox", item);
}

// --- Transports ----------------------------------------------------- //

export async function pushTransportMsg(msg: TransportMessage): Promise<void> {
  const db = await getDB();
  await db.put("transports", msg);
}

export async function listTransportMsgs(toCircle: string): Promise<TransportMessage[]> {
  const db = await getDB();
  return (await db.getAllFromIndex("transports", "toCircle", toCircle)) as TransportMessage[];
}

// --- Stealth outputs ------------------------------------------------ //

export async function pushStealthOutput(out: StealthOutput): Promise<void> {
  const db = await getDB();
  await db.put("stealth", out);
}

export async function listStealthOutputs(sinceTs = 0): Promise<StealthOutput[]> {
  const db = await getDB();
  const all = (await db.getAll("stealth")) as StealthOutput[];
  return all.filter((o) => o.ts >= sinceTs).sort((a, b) => a.ts - b.ts);
}

// --- Polls ---------------------------------------------------------- //

export async function savePoll(poll: PollRecord): Promise<void> {
  const db = await getDB();
  await db.put("polls", poll);
}

export async function getPoll(id: string): Promise<PollRecord | undefined> {
  const db = await getDB();
  return db.get("polls", id);
}

export async function listPolls(circleId?: string): Promise<PollRecord[]> {
  const db = await getDB();
  if (circleId) {
    return (await db.getAllFromIndex("polls", "circleId", circleId)) as PollRecord[];
  }
  return (await db.getAll("polls")) as PollRecord[];
}

// --- Generic KV ----------------------------------------------------- //

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await getDB();
  return (await db.get("kv", key)) as T | undefined;
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  const db = await getDB();
  await db.put("kv", value, key);
}

export async function kvDelete(key: string): Promise<void> {
  const db = await getDB();
  await db.delete("kv", key);
}

// --- Wipe ----------------------------------------------------------- //

export async function wipeAll(): Promise<void> {
  const db = await getDB();
  const stores = ["wallets", "contacts", "circles", "entries", "outbox", "transports", "stealth", "polls", "kv"];
  const tx = db.transaction(stores, "readwrite");
  await Promise.all(stores.map((s) => tx.objectStore(s).clear()));
  await tx.done;
}
