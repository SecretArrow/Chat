"use client";

/**
 * NewChatModal — create a new DM, Room, or Group.
 *
 * DM tab:
 *   - Pick an existing contact (uses their curvePub), OR
 *   - Paste Octra address + curve pub (cp_…)
 *   - createDMCircle returns { circle, sharedKey } — only the circle is
 *     persisted via store.addCircle; the shared key is recomputed at
 *     decrypt-time from the identity's curve secret + counterparty curve pub.
 *
 * Room tab:
 *   - name + description
 *   - createRoomCircle generates a room Curve keypair and publishes the pub
 *
 * Group tab:
 *   - name + description + initial member selection from contacts
 *   - createGroupCircle then joinMember for each selected contact
 */
import { useMemo, useState } from "react";
import {
  Globe,
  KeyRound,
  Lock,
  MessageSquare,
  Plus,
  Users,
} from "lucide-react";
import { useChatStore } from "@/stores/chat-store";
import {
  createDMCircle,
  createGroupCircle,
  createRoomCircle,
} from "@/lib/octra/circle";
import type { CircleMember } from "@/lib/octra/circle";
import { decodeCurvePub, isValidOctraAddress } from "@/lib/octra/crypto";
import { cn, shortAddress } from "@/lib/utils";
import {
  Avatar,
  Badge,
  EmptyState,
  Field,
  Modal,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from "@/components/_primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/input";

interface NewChatModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Initial tab (defaults to "dm"). */
  initialTab?: "dm" | "room" | "group";
}

export function NewChatModal({
  open,
  onOpenChange,
  initialTab = "dm",
}: NewChatModalProps) {
  const identity = useChatStore((s) => s.identity);
  const contacts = useChatStore((s) => s.contacts);
  const addCircle = useChatStore((s) => s.addCircle);
  const joinMember = useChatStore((s) => s.joinMember);
  const addContact = useChatStore((s) => s.addContact);
  const setView = useChatStore((s) => s.setView);
  const { toast } = useToast();

  const [tab, setTab] = useState<"dm" | "room" | "group">(initialTab);

  // DM
  const [pickedContact, setPickedContact] = useState<string | "">("");
  const [dmAddr, setDmAddr] = useState("");
  const [dmCp, setDmCp] = useState("");
  const [dmNickname, setDmNickname] = useState("");

  // Room
  const [roomName, setRoomName] = useState("");
  const [roomDesc, setRoomDesc] = useState("");

  // Group
  const [groupName, setGroupName] = useState("");
  const [groupDesc, setGroupDesc] = useState("");
  const [groupMembers, setGroupMembers] = useState<Set<string>>(new Set());

  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setPickedContact("");
    setDmAddr("");
    setDmCp("");
    setDmNickname("");
    setRoomName("");
    setRoomDesc("");
    setGroupName("");
    setGroupDesc("");
    setGroupMembers(new Set());
  };

  const contactsNotInDms = useMemo(() => {
    // For simplicity we just list all contacts. We could filter to those
    // without an existing DM, but the deterministic circle id makes
    // re-creation a no-op (same id, just updates members).
    return contacts;
  }, [contacts]);

  if (!identity) return null;

  const onTabChange = (v: string) => {
    setTab(v as "dm" | "room" | "group");
  };

  /* ----- DM creation ----- */
  const onCreateDm = async () => {
    if (!identity) return;
    let otherAddr = dmAddr.trim();
    let otherCp = dmCp.trim();
    let otherNickname = dmNickname.trim();

    if (pickedContact) {
      const c = contacts.find((x) => x.id === pickedContact);
      if (!c) return;
      otherAddr = c.address;
      otherCp = c.curvePub;
      otherNickname = c.nickname;
    }

    if (!isValidOctraAddress(otherAddr)) {
      toast({ title: "Invalid Octra address", variant: "danger" });
      return;
    }
    if (!otherCp.startsWith("cp_")) {
      toast({ title: "Curve pub must start with cp_", variant: "danger" });
      return;
    }
    let curvePubBytes: Uint8Array;
    try {
      curvePubBytes = decodeCurvePub(otherCp);
    } catch {
      toast({ title: "Invalid curve pub encoding", variant: "danger" });
      return;
    }

    setSubmitting(true);
    try {
      const { circle } = await createDMCircle(identity, {
        address: otherAddr,
        curvePub: curvePubBytes,
      });
      await addCircle(circle);

      // If a nickname was provided and not an existing contact, save contact.
      if (otherNickname && !pickedContact) {
        await addContact({
          address: otherAddr,
          nickname: otherNickname,
          curvePub: otherCp,
        }).catch(() => {});
      }

      toast({
        title: "DM circle ready",
        description: "Encrypted with Curve25519 ECDH + XSalsa20-Poly1305",
        variant: "success",
      });
      reset();
      onOpenChange(false);
      setView({ kind: "app", section: "messages", activeCircleId: circle.id });
    } catch (err) {
      toast({
        title: "Failed to create DM",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "danger",
      });
    } finally {
      setSubmitting(false);
    }
  };

  /* ----- Room creation ----- */
  const onCreateRoom = async () => {
    if (!identity) return;
    if (!roomName.trim()) {
      toast({ title: "Room name is required", variant: "danger" });
      return;
    }
    setSubmitting(true);
    try {
      const circle = await createRoomCircle(identity, roomName.trim(), roomDesc.trim() || undefined);
      await addCircle(circle);
      toast({
        title: "Public room created",
        description: "Anyone with the room ID + curve pub can read and post.",
        variant: "success",
      });
      reset();
      onOpenChange(false);
      setView({ kind: "app", section: "rooms", activeCircleId: circle.id });
    } catch (err) {
      toast({
        title: "Failed to create room",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "danger",
      });
    } finally {
      setSubmitting(false);
    }
  };

  /* ----- Group creation ----- */
  const onCreateGroup = async () => {
    if (!identity) return;
    if (!groupName.trim()) {
      toast({ title: "Group name is required", variant: "danger" });
      return;
    }
    setSubmitting(true);
    try {
      const circle = await createGroupCircle(identity, groupName.trim(), groupDesc.trim() || undefined);
      await addCircle(circle);

      // Add selected members
      const toAdd = contacts.filter((c) => groupMembers.has(c.id));
      for (const c of toAdd) {
        const member: CircleMember = {
          address: c.address,
          curvePub: c.curvePub,
          role: "member",
          joinedAt: Date.now(),
          invitedBy: identity.address,
          slotIndex: circle.slots.length, // approx; store will re-read
        };
        // Re-read latest circle from store each iteration to keep slotIndex correct
        const latest = useChatStore.getState().circles.find((x) => x.id === circle.id);
        member.slotIndex = latest ? latest.slots.length : circle.slots.length;
        await joinMember(circle.id, member);
      }

      toast({
        title: "Group created",
        description: `Private group with ${toAdd.length + 1} member${toAdd.length === 0 ? "" : "s"}.`,
        variant: "success",
      });
      reset();
      onOpenChange(false);
      setView({ kind: "app", section: "groups", activeCircleId: circle.id });
    } catch (err) {
      toast({
        title: "Failed to create group",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "danger",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleMember = (id: string) => {
    setGroupMembers((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title={
        <span className="inline-flex items-center gap-2">
          <Plus className="h-4 w-4 text-accent" />
          New conversation
        </span>
      }
      description="Pick a conversation type — each uses different Octra Circle primitives."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          {tab === "dm" && (
            <Button onClick={onCreateDm} loading={submitting} disabled={!pickedContact && (!dmAddr || !dmCp)}>
              Create DM
            </Button>
          )}
          {tab === "room" && (
            <Button onClick={onCreateRoom} loading={submitting} disabled={!roomName.trim()}>
              Create room
            </Button>
          )}
          {tab === "group" && (
            <Button onClick={onCreateGroup} loading={submitting} disabled={!groupName.trim()}>
              Create group
            </Button>
          )}
        </>
      }
    >
      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList className="w-full grid grid-cols-3">
          <TabsTrigger value="dm">
            <Lock className="h-3.5 w-3.5 mr-1.5" />
            New DM
          </TabsTrigger>
          <TabsTrigger value="room">
            <Globe className="h-3.5 w-3.5 mr-1.5" />
            New Room
          </TabsTrigger>
          <TabsTrigger value="group">
            <Users className="h-3.5 w-3.5 mr-1.5" />
            New Group
          </TabsTrigger>
        </TabsList>

        {/* DM */}
        <TabsContent value="dm" className="pt-4 space-y-3">
          <div className="rounded-md border border-border bg-accent-soft/40 p-3 text-xs text-text-muted flex items-start gap-2">
            <Lock className="h-4 w-4 text-accent shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-text">End-to-end encrypted DM</p>
              <p className="mt-0.5">
                Uses Curve25519 ECDH to derive a shared key, then XSalsa20-Poly1305
                (crypto_box.after) for each message. Circle ID is deterministic from
                both participants&rsquo; curve pubs.
              </p>
            </div>
          </div>

          {contactsNotInDms.length > 0 && (
            <Field label="Pick a contact">
              <ul className="max-h-44 overflow-y-auto rounded-md border border-border divide-y divide-border">
                {contactsNotInDms.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setPickedContact(pickedContact === c.id ? "" : c.id)}
                      className={cn(
                        "w-full flex items-center gap-3 p-2 text-left transition-colors",
                        pickedContact === c.id ? "bg-accent-soft" : "hover:bg-surface-2/70",
                      )}
                    >
                      <Avatar name={c.nickname} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-text truncate">{c.nickname}</p>
                        <p className="text-[10px] text-text-faint font-mono truncate">
                          {shortAddress(c.address, 8, 6)}
                        </p>
                      </div>
                      {pickedContact === c.id && (
                        <Badge variant="accent">selected</Badge>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </Field>
          )}

          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-surface px-2 text-[10px] uppercase text-text-faint">
                or paste manually
              </span>
            </div>
          </div>

          <Field
            label="Octra address"
            helperText="47-char address starting with oct…"
          >
            <Input
              value={dmAddr}
              onChange={(e) => setDmAddr(e.target.value.trim())}
              placeholder="oct…"
              disabled={!!pickedContact}
              className="font-mono"
            />
          </Field>
          <Field
            label="Curve25519 public key"
            helperText="cp_<base64>. Required to encrypt messages to them."
          >
            <Input
              value={dmCp}
              onChange={(e) => setDmCp(e.target.value.trim())}
              placeholder="cp_…"
              disabled={!!pickedContact}
              className="font-mono"
            />
          </Field>
          <Field
            label="Save as contact nickname (optional)"
            helperText="Saves this address + curve pub to your contacts for next time."
          >
            <Input
              value={dmNickname}
              onChange={(e) => setDmNickname(e.target.value)}
              placeholder="e.g. Alice"
              disabled={!!pickedContact}
            />
          </Field>
        </TabsContent>

        {/* Room */}
        <TabsContent value="room" className="pt-4 space-y-3">
          <div className="rounded-md border border-border bg-accent-soft/40 p-3 text-xs text-text-muted flex items-start gap-2">
            <Globe className="h-4 w-4 text-accent shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-text">Public chat room</p>
              <p className="mt-0.5">
                A shared Curve25519 keypair is generated for the room. Anyone with
                the room ID + room curve pub can derive the symmetric key and read
                or post. Use for open channels.
              </p>
            </div>
          </div>
          <Field label="Room name" required>
            <Input
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="e.g. dev-general"
            />
          </Field>
          <Field label="Description (optional)">
            <Textarea
              value={roomDesc}
              onChange={(e) => setRoomDesc(e.target.value)}
              placeholder="What's this room about?"
              rows={2}
            />
          </Field>
        </TabsContent>

        {/* Group */}
        <TabsContent value="group" className="pt-4 space-y-3">
          <div className="rounded-md border border-border bg-accent-soft/40 p-3 text-xs text-text-muted flex items-start gap-2">
            <KeyRound className="h-4 w-4 text-accent shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-text">Private group</p>
              <p className="mt-0.5">
                Every message is wrapped per-recipient: a fresh message key encrypts
                the body, then that key is encrypted to each member&rsquo;s Curve25519
                pub. Only invited members can decrypt.
              </p>
            </div>
          </div>
          <Field label="Group name" required>
            <Input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. Engineering"
            />
          </Field>
          <Field label="Description (optional)">
            <Textarea
              value={groupDesc}
              onChange={(e) => setGroupDesc(e.target.value)}
              placeholder="What's this group about?"
              rows={2}
            />
          </Field>
          {contacts.length === 0 ? (
            <EmptyState
              icon={<Users className="h-5 w-5" />}
              title="No contacts yet"
              description="Add contacts first from the Contacts tab."
            />
          ) : (
            <Field label="Initial members">
              <ul className="max-h-44 overflow-y-auto rounded-md border border-border divide-y divide-border">
                {contacts.map((c) => {
                  const sel = groupMembers.has(c.id);
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => toggleMember(c.id)}
                        className={cn(
                          "w-full flex items-center gap-3 p-2 text-left transition-colors",
                          sel ? "bg-accent-soft" : "hover:bg-surface-2/70",
                        )}
                      >
                        <Avatar name={c.nickname} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-text truncate">{c.nickname}</p>
                          <p className="text-[10px] text-text-faint font-mono truncate">
                            {shortAddress(c.address, 8, 6)}
                          </p>
                        </div>
                        {sel && <Badge variant="accent">added</Badge>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Field>
          )}
        </TabsContent>
      </Tabs>
    </Modal>
  );
}

export type { NewChatModalProps };
