"use client";

/**
 * ContactsView — manage Octra contacts.
 *
 * - List of contacts: avatar, nickname, short address, added time, note.
 * - "Add Contact" button opens a modal with nickname, Octra address (validated),
 *   curve pub (cp_…, validated), optional note.
 * - Click a contact to open detail modal with full address (with CopyButton),
 *   curve pub, "Start DM" (creates DM circle if not exists), "Remove contact".
 */
import { useMemo, useState } from "react";
import {
  MessageSquare,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { useChatStore } from "@/stores/chat-store";
import type { CircleMember } from "@/lib/octra/circle";
import { createDMCircle } from "@/lib/octra/circle";
import { decodeCurvePub, isValidOctraAddress } from "@/lib/octra/crypto";
import { cn, formatDate, shortAddress } from "@/lib/utils";
import {
  Avatar,
  Badge,
  CopyButton,
  EmptyState,
  Field,
  Modal,
  useToast,
} from "@/components/_primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/input";

export function ContactsView() {
  const contacts = useChatStore((s) => s.contacts);
  const addContact = useChatStore((s) => s.addContact);
  const removeContact = useChatStore((s) => s.removeContact);
  const circles = useChatStore((s) => s.circles);
  const identity = useChatStore((s) => s.identity);
  const addCircle = useChatStore((s) => s.addCircle);
  const setView = useChatStore((s) => s.setView);
  const { toast } = useToast();

  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [activeContactId, setActiveContactId] = useState<string | null>(null);

  // Add form state
  const [nNick, setNNick] = useState("");
  const [nAddr, setNAddr] = useState("");
  const [nCp, setNCp] = useState("");
  const [nNote, setNNote] = useState("");
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts
      .filter(
        (c) =>
          !q ||
          c.nickname.toLowerCase().includes(q) ||
          c.address.toLowerCase().includes(q) ||
          c.curvePub.toLowerCase().includes(q),
      )
      .sort((a, b) => b.addedAt - a.addedAt);
  }, [contacts, query]);

  const activeContact = contacts.find((c) => c.id === activeContactId) ?? null;

  const resetForm = () => {
    setNNick("");
    setNAddr("");
    setNCp("");
    setNNote("");
  };

  const onAdd = async () => {
    if (!nNick.trim()) {
      toast({ title: "Nickname required", variant: "danger" });
      return;
    }
    if (!isValidOctraAddress(nAddr.trim())) {
      toast({ title: "Invalid Octra address", variant: "danger" });
      return;
    }
    if (!nCp.trim().startsWith("cp_")) {
      toast({ title: "Curve pub must start with cp_", variant: "danger" });
      return;
    }
    try {
      decodeCurvePub(nCp.trim());
    } catch {
      toast({ title: "Invalid curve pub encoding", variant: "danger" });
      return;
    }
    setSaving(true);
    try {
      await addContact({
        address: nAddr.trim(),
        nickname: nNick.trim(),
        curvePub: nCp.trim(),
        note: nNote.trim() || undefined,
      });
      toast({ title: "Contact saved", variant: "success" });
      resetForm();
      setShowAdd(false);
    } catch (err) {
      toast({
        title: "Failed to save contact",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const onRemove = async (id: string) => {
    await removeContact(id);
    setActiveContactId(null);
    toast({ title: "Contact removed", variant: "default" });
  };

  const onStartDm = async (contactId: string) => {
    if (!identity) return;
    const c = contacts.find((x) => x.id === contactId);
    if (!c) return;
    // Try to find existing DM circle with this contact
    const existing = circles.find(
      (ci) =>
        ci.kind === "dm" &&
        ci.members.some((m) => m.address === c.address),
    );
    if (existing) {
      setView({ kind: "app", section: "messages", activeCircleId: existing.id });
      setActiveContactId(null);
      return;
    }
    try {
      const curvePub = decodeCurvePub(c.curvePub);
      const { circle } = await createDMCircle(identity, {
        address: c.address,
        curvePub,
      });
      await addCircle(circle);
      setActiveContactId(null);
      setView({ kind: "app", section: "messages", activeCircleId: circle.id });
      toast({
        title: "DM circle ready",
        description: "Encrypted with Curve25519 ECDH + XSalsa20-Poly1305",
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Failed to start DM",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "danger",
      });
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-surface">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-text">
            <Users className="h-4 w-4 text-accent" />
            Contacts
            <Badge variant="default" className="ml-1">{filtered.length}</Badge>
          </h2>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" />
            Add contact
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, address, or curve pub"
            className="pl-8"
            aria-label="Search contacts"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <EmptyState
            className="py-12"
            icon={<Users className="h-6 w-6" />}
            title={contacts.length === 0 ? "No contacts yet" : "No matches"}
            description={
              contacts.length === 0
                ? "Add a contact with their Octra address and Curve25519 public key (cp_…) to start encrypted DMs."
                : "Try a different search query."
            }
            action={
              contacts.length === 0 ? (
                <Button size="sm" onClick={() => setShowAdd(true)}>
                  <UserPlus className="h-4 w-4" />
                  Add your first contact
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setActiveContactId(c.id)}
                  className={cn(
                    "group w-full text-left px-3 py-3 rounded-lg flex items-center gap-3 transition-colors hover:bg-surface-2/70",
                  )}
                >
                  <Avatar name={c.nickname} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-text">
                        {c.nickname}
                      </span>
                      <span className="ml-auto shrink-0 text-[10px] text-text-faint">
                        {formatDate(c.addedAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-text-muted font-mono">
                      {shortAddress(c.address, 10, 8)}
                    </p>
                    {c.note && (
                      <p className="mt-0.5 truncate text-[10px] text-text-faint">
                        {c.note}
                      </p>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add Modal */}
      <Modal
        open={showAdd}
        onOpenChange={(o) => {
          if (!o) resetForm();
          setShowAdd(o);
        }}
        title={
          <span className="inline-flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-accent" />
            Add contact
          </span>
        }
        description="Store an Octra address + Curve25519 pub so you can start DMs without re-pasting."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowAdd(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={onAdd} loading={saving}>
              Save contact
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Nickname" required>
            <Input
              value={nNick}
              onChange={(e) => setNNick(e.target.value)}
              placeholder="e.g. Alice"
              autoFocus
            />
          </Field>
          <Field
            label="Octra address"
            required
            helperText="47 chars starting with oct…"
          >
            <Input
              value={nAddr}
              onChange={(e) => setNAddr(e.target.value.trim())}
              placeholder="oct…"
              className="font-mono"
            />
          </Field>
          <Field
            label="Curve25519 public key"
            required
            helperText="cp_<base64>. They can share this from their Wallet tab."
          >
            <Input
              value={nCp}
              onChange={(e) => setNCp(e.target.value.trim())}
              placeholder="cp_…"
              className="font-mono"
            />
          </Field>
          <Field label="Note (optional)">
            <Textarea
              value={nNote}
              onChange={(e) => setNNote(e.target.value)}
              placeholder="How do you know them? Anything to remember…"
              rows={2}
            />
          </Field>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal
        open={!!activeContact}
        onOpenChange={(o) => !o && setActiveContactId(null)}
        title={activeContact?.nickname}
        description={activeContact ? shortAddress(activeContact.address, 10, 8) : ""}
        size="md"
      >
        {activeContact && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={activeContact.nickname} size="lg" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text">{activeContact.nickname}</p>
                <p className="text-xs text-text-muted">Added {formatDate(activeContact.addedAt)}</p>
              </div>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wide text-text-faint mb-1">
                Octra address
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-surface-2 rounded px-2 py-1.5 text-[10px] font-mono break-all text-text">
                  {activeContact.address}
                </code>
                <CopyButton value={activeContact.address} />
              </div>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wide text-text-faint mb-1">
                Curve25519 public key
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-surface-2 rounded px-2 py-1.5 text-[10px] font-mono break-all text-text">
                  {activeContact.curvePub}
                </code>
                <CopyButton value={activeContact.curvePub} />
              </div>
            </div>

            {activeContact.note && (
              <div className="rounded-md border border-border p-3 text-sm text-text-muted">
                {activeContact.note}
              </div>
            )}

            <div className="flex flex-col gap-2 pt-2">
              <Button onClick={() => onStartDm(activeContact.id)}>
                <MessageSquare className="h-4 w-4" />
                Start DM (E2E encrypted)
              </Button>
              <Button
                variant="danger"
                onClick={() => onRemove(activeContact.id)}
              >
                <Trash2 className="h-4 w-4" />
                Remove contact
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
