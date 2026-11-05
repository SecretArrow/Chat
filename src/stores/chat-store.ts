/**
 * OctraChat store — Zustand
 * ------------------------------------------------------------------
 * Single source of truth for the running session:
 *   - active wallet (unlocked Identity) or null when locked
 *   - contacts, circles, polls, stealth outputs
 *   - active circle / active view
 *   - network config
 *
 * All persistence goes through the IndexedDB layer. The store holds
 * the in-memory state plus the decrypted Identity for the active session.
 */

"use client";

import { create } from "zustand";
import type { Identity } from "@/lib/octra/crypto";
import {
  listWallets,
  listContacts,
  listCircles,
  listEntries,
  listPolls,
  listStealthOutputs,
  saveContact,
  saveCircle,
  deleteContact as dbDeleteContact,
  deleteCircle as dbDeleteCircle,
  appendEntry,
  getDefaultWallet,
  kvGet,
  kvSet,
  type WalletRecord,
  type ContactRecord,
  type PollRecord,
} from "@/lib/octra/db";
import type { Circle, StorageEntry, CircleMember, MemberRole } from "@/lib/octra/circle";
import { joinCircle, leaveCircle, promoteMember } from "@/lib/octra/circle";
import type { StealthOutput } from "@/lib/octra/stealth";
import {
  unlockWallet,
  createNewWallet,
  importFromMnemonic,
  importFromPrivKey,
} from "@/lib/octra/wallet";
import type { OctraNetwork } from "@/lib/octra/rpc";

export type AppView =
  | { kind: "landing" }
  | { kind: "setup" }
  | { kind: "unlock"; address?: string }
  | { kind: "app"; section: "messages" | "rooms" | "groups" | "contacts" | "wallet" | "stealth"; activeCircleId?: string };

interface ChatState {
  // session
  identity: Identity | null;
  wallets: WalletRecord[];
  locked: boolean;
  hydrated: boolean;

  // data
  contacts: ContactRecord[];
  circles: Circle[];
  entries: Record<string, StorageEntry[]>; // circleId -> entries
  polls: PollRecord[];
  stealthOutputs: StealthOutput[];

  // navigation
  view: AppView;
  network: OctraNetwork;
  rpcHealthy: boolean | null;

  // actions
  hydrate: () => Promise<void>;
  refreshWallets: () => Promise<void>;
  createWallet: (label: string, pin: string) => Promise<void>;
  importWallet: (mnemonic: string, label: string, pin: string) => Promise<void>;
  importWalletFromPrivKey: (privKeyB64: string, label: string, pin: string) => Promise<void>;
  unlock: (address: string, pin: string) => Promise<void>;
  lock: () => void;
  switchWallet: (address: string, pin: string) => Promise<void>;

  setView: (v: AppView) => void;
  setNetwork: (n: OctraNetwork) => Promise<void>;

  addContact: (c: Omit<ContactRecord, "id" | "addedAt">) => Promise<ContactRecord>;
  removeContact: (id: string) => Promise<void>;

  addCircle: (c: Circle) => Promise<void>;
  refreshCircles: () => Promise<void>;
  removeCircle: (id: string) => Promise<void>;
  joinMember: (circleId: string, member: CircleMember) => Promise<void>;
  leaveMember: (circleId: string, address: string) => Promise<void>;
  promote: (circleId: string, address: string, role: MemberRole) => Promise<void>;

  appendMessage: (entry: StorageEntry) => Promise<void>;
  refreshEntries: (circleId: string) => Promise<void>;
  refreshPolls: (circleId?: string) => Promise<void>;
  refreshStealth: () => Promise<void>;
  savePollRecord: (p: PollRecord) => Promise<void>;
}

const DEFAULT_VIEW: AppView = { kind: "landing" };

export const useChatStore = create<ChatState>((set, get) => ({
  identity: null,
  wallets: [],
  locked: true,
  hydrated: false,

  contacts: [],
  circles: [],
  entries: {},
  polls: [],
  stealthOutputs: [],

  view: DEFAULT_VIEW,
  network: "devnet",
  rpcHealthy: null,

  hydrate: async () => {
    const wallets = await listWallets();
    const contacts = await listContacts();
    const circles = await listCircles();
    const polls = await listPolls();
    const stealthOutputs = await listStealthOutputs();
    const net = (await kvGet<OctraNetwork>("network")) ?? "devnet";
    const defaultWallet = await getDefaultWallet();

    set({
      wallets,
      contacts,
      circles,
      polls,
      stealthOutputs,
      network: net,
      hydrated: true,
      view:
        wallets.length === 0
          ? { kind: "setup" }
          : { kind: "unlock", address: defaultWallet?.address },
    });
  },

  refreshWallets: async () => {
    const wallets = await listWallets();
    set({ wallets });
  },

  createWallet: async (label, pin) => {
    const { identity, record } = await createNewWallet(label, pin);
    const wallets = await listWallets();
    set({ identity, wallets, locked: false, view: { kind: "app", section: "messages" } });
  },

  importWallet: async (mnemonic, label, pin) => {
    const { identity, record } = await importFromMnemonic(mnemonic, label, pin);
    const wallets = await listWallets();
    set({ identity, wallets, locked: false, view: { kind: "app", section: "messages" } });
  },

  importWalletFromPrivKey: async (privKeyB64, label, pin) => {
    const { identity, record } = await importFromPrivKey(privKeyB64, label, pin);
    const wallets = await listWallets();
    set({ identity, wallets, locked: false, view: { kind: "app", section: "messages" } });
  },

  unlock: async (address, pin) => {
    const identity = await unlockWallet(address, pin);
    set({ identity, locked: false, view: { kind: "app", section: "messages" } });
    // Lazy load entries for the first circle if any
    const circles = await listCircles();
    if (circles.length > 0) {
      const first = circles[0];
      const entries = await listEntries(first.id);
      set((s) => ({ entries: { ...s.entries, [first.id]: entries } }));
    }
  },

  lock: () => {
    set({ identity: null, locked: true, view: { kind: "unlock", address: get().identity?.address } });
  },

  switchWallet: async (address, pin) => {
    const identity = await unlockWallet(address, pin);
    set({ identity, locked: false });
  },

  setView: (v) => set({ view: v }),

  setNetwork: async (n) => {
    await kvSet("network", n);
    set({ network: n, rpcHealthy: null });
  },

  addContact: async (c) => {
    const rec: ContactRecord = {
      id: c.address,
      address: c.address,
      nickname: c.nickname,
      curvePub: c.curvePub,
      addedAt: Date.now(),
      note: c.note,
      avatarColor: c.avatarColor,
    };
    await saveContact(rec);
    const contacts = await listContacts();
    set({ contacts });
    return rec;
  },

  removeContact: async (id) => {
    await dbDeleteContact(id);
    const contacts = await listContacts();
    set({ contacts });
  },

  addCircle: async (c) => {
    await saveCircle(c);
    const circles = await listCircles();
    set({ circles });
  },

  refreshCircles: async () => {
    const circles = await listCircles();
    set({ circles });
  },

  removeCircle: async (id) => {
    await dbDeleteCircle(id);
    const circles = await listCircles();
    set((s) => {
      const next = { ...s.entries };
      delete next[id];
      return { circles, entries: next };
    });
  },

  joinMember: async (circleId, member) => {
    const circle = get().circles.find((c) => c.id === circleId);
    if (!circle) return;
    const next = joinCircle(circle, member);
    await saveCircle(next);
    const circles = await listCircles();
    set({ circles });
  },

  leaveMember: async (circleId, address) => {
    const circle = get().circles.find((c) => c.id === circleId);
    if (!circle) return;
    const next = leaveCircle(circle, address);
    await saveCircle(next);
    const circles = await listCircles();
    set({ circles });
  },

  promote: async (circleId, address, role) => {
    const circle = get().circles.find((c) => c.id === circleId);
    if (!circle) return;
    const next = promoteMember(circle, address, role);
    await saveCircle(next);
    const circles = await listCircles();
    set({ circles });
  },

  appendMessage: async (entry) => {
    await appendEntry(entry);
    set((s) => {
      const existing = s.entries[entry.circleId] ?? [];
      const next = [...existing, entry].sort((a, b) => a.ts - b.ts);
      return { entries: { ...s.entries, [entry.circleId]: next } };
    });
  },

  refreshEntries: async (circleId) => {
    const entries = await listEntries(circleId);
    set((s) => ({ entries: { ...s.entries, [circleId]: entries } }));
  },

  refreshPolls: async (circleId) => {
    const polls = circleId ? await listPolls(circleId) : await listPolls();
    set({ polls });
  },

  refreshStealth: async () => {
    const stealthOutputs = await listStealthOutputs();
    set({ stealthOutputs });
  },

  savePollRecord: async (p) => {
    const { savePoll } = await import("@/lib/octra/db");
    await savePoll(p);
    const polls = await listPolls();
    set({ polls });
  },
}));
