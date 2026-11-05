const { execSync } = require("child_process");

function ab(cmd) {
  try {
    return execSync(`agent-browser ${cmd}`, {
      encoding: "utf-8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    return (e.stdout || "") + (e.stderr || "");
  }
}

function findRefs(snap, label) {
  const refs = [];
  for (const line of snap.split("\n")) {
    if (line.toLowerCase().includes(label.toLowerCase())) {
      const m = line.match(/\[ref=(\S+?)\]/);
      if (m) refs.push({ ref: m[1], line: line.trim() });
    }
  }
  return refs;
}

function findBoxes(snap) {
  const out = [];
  for (const line of snap.split("\n")) {
    if (line.includes("textbox") || line.includes("combobox")) {
      const labelM = line.match(/(?:textbox|combobox) "?([^"\[]+)"? \[/);
      const refM = line.match(/\[ref=(\S+?)\]/);
      if (refM) out.push({ label: labelM ? labelM[1].trim() : "?", ref: refM[1], line: line.trim() });
    }
  }
  return out;
}

const CONTACT = {
  nickname: "Alice Test",
  address: "octC7YjeiCkao1xQaVUZYMDZQRuTXz8D2uzypB1gsUSVX1x",
  curvePub: "cp_bMVInTJe1n240z/3FARyulpZGgNQJVd8Wq7zSKvwNkQ=",
};

// Close any open modal first (press Escape)
ab("press Escape");
ab("wait 500");

// Go to Contacts
let snap = ab("snapshot -i");
const contactsNav = findRefs(snap, "Contacts");
if (contactsNav.length === 0) {
  console.log("FAIL: no Contacts nav");
  process.exit(1);
}
ab(`click @${contactsNav[0].ref}`);
ab("wait 800");

console.log("=== Contacts view ===");
let body = ab('eval "document.body.innerText.slice(0, 400)"').trim();
try { body = JSON.parse(body); } catch {}
console.log(body.slice(0, 400));

// Click "Add contact"
snap = ab("snapshot -i");
const addBtn = findRefs(snap, "Add contact");
if (addBtn.length === 0) {
  console.log("FAIL: no Add contact button");
  process.exit(1);
}
ab(`click @${addBtn[0].ref}`);
ab("wait 800");

console.log("\n=== Add Contact modal ===");
snap = ab("snapshot -i");
const boxes = findBoxes(snap);
console.log("Boxes:", boxes.map((b) => ({ label: b.label, ref: b.ref })));

// Map by placeholder text
function findBoxByPlaceholder(text) {
  for (const b of boxes) {
    if (b.label.includes(text) || b.line.includes(text)) return b.ref;
  }
  return null;
}

const nickRef = findBoxByPlaceholder("e.g. Alice") || findBoxByPlaceholder("Alice");
const addrRef = findBoxByPlaceholder("oct…") || findBoxByPlaceholder("oct");
const curveRef = findBoxByPlaceholder("cp_…") || findBoxByPlaceholder("cp_");
console.log("Refs:", { nickRef, addrRef, curveRef });

if (!nickRef || !addrRef || !curveRef) {
  console.log("FAIL: couldn't map boxes");
  process.exit(1);
}

ab(`fill @${nickRef} "${CONTACT.nickname}"`);
ab(`fill @${addrRef} "${CONTACT.address}"`);
ab(`fill @${curveRef} "${CONTACT.curvePub}"`);
ab("wait 500");

// Click Save
snap = ab("snapshot -i");
const saveBtn = findRefs(snap, "Save contact")[0] || findRefs(snap, "Save")[0];
console.log("Save button:", saveBtn);
if (!saveBtn) {
  console.log("FAIL: no save button");
  process.exit(1);
}
ab(`click @${saveBtn.ref}`);
ab("wait 1500");

console.log("\n=== After save ===");
body = ab('eval "document.body.innerText.slice(0, 600)"').trim();
try { body = JSON.parse(body); } catch {}
console.log(body.slice(0, 600));

// Verify Alice appears in the contacts list
snap = ab("snapshot -i");
const alice = findRefs(snap, "Alice Test");
console.log("\nAlice in contacts:", alice);
if (alice.length === 0) {
  console.log("FAIL: contact not saved");
  console.log(snap.slice(0, 1200));
  process.exit(1);
}

console.log("\n=== PASSED: Contact saved! ===");

// Now go to Messages and start a DM
ab("press Escape");
ab("wait 300");
snap = ab("snapshot -i");
const messagesNav = findRefs(snap, "Messages");
ab(`click @${messagesNav[0].ref}`);
ab("wait 800");

console.log("\n=== Messages view ===");
snap = ab("snapshot -i");
console.log(snap.slice(0, 1200));

// Find New chat or Start new button
const newBtn = findRefs(snap, "New chat")[0] || findRefs(snap, "Start new")[0] || findRefs(snap, "New")[0];
console.log("\nNew button:", newBtn);
if (newBtn) {
  ab(`click @${newBtn.ref}`);
  ab("wait 800");
}

console.log("\n=== New chat modal ===");
snap = ab("snapshot -i");
console.log(snap.slice(0, 1500));

// Look for DM tab
const dmTab = findRefs(snap, "DM")[0] || findRefs(snap, "Direct")[0];
if (dmTab) {
  console.log("Clicking DM tab:", dmTab);
  ab(`click @${dmTab.ref}`);
  ab("wait 500");
  snap = ab("snapshot -i");
  console.log("After DM tab:\n" + snap.slice(0, 1500));
}

// Find Alice in the modal list
const aliceInModal = findRefs(snap, "Alice");
console.log("\nAlice in modal:", aliceInModal);
if (aliceInModal.length > 0) {
  // Click the button (not the textbox)
  const aliceBtn = aliceInModal.find((a) => a.line.includes("button")) || aliceInModal[0];
  ab(`click @${aliceBtn.ref}`);
  ab("wait 800");

  // After selecting Alice, look for a Create / Start button in the modal
  const snap2 = ab("snapshot -i");
  console.log("\nAfter Alice selected:\n" + snap2.slice(0, 2000));
  const createBtn =
    findRefs(snap2, "Create DM")[0] ||
    findRefs(snap2, "Start DM")[0] ||
    findRefs(snap2, "Begin")[0] ||
    findRefs(snap2, "Create conversation")[0] ||
    findRefs(snap2, "Start conversation")[0] ||
    findRefs(snap2, "Create")[0] ||
    findRefs(snap2, "Start")[0];
  console.log("Create button:", createBtn);
  if (createBtn) {
    ab(`click @${createBtn.ref}`);
    ab("wait 1500");
  } else {
    console.log("No create button found — modal snapshot above");
  }
}

console.log("\n=== After starting DM ===");
body = ab('eval "document.body.innerText.slice(0, 600)"').trim();
try { body = JSON.parse(body); } catch {}
console.log(body.slice(0, 600));

snap = ab("snapshot -i");
console.log("\nChat elements:\n" + snap.slice(0, 1500));

// Find composer — it's typically a textbox with placeholder like "Type" or "Message"
const allBoxes = findBoxes(snap);
console.log("All boxes:", allBoxes);
const composer = allBoxes.find((b) => b.label.toLowerCase().includes("type") || b.label.toLowerCase().includes("message") || b.label.toLowerCase().includes("send")) || allBoxes[allBoxes.length - 1];
console.log("Composer:", composer);

if (composer) {
  ab(`fill @${composer.ref} "Hello Octra! This is an E2E encrypted test message."`);
  ab("wait 500");
  // Try send button or Enter
  const snap2 = ab("snapshot -i");
  const sendBtn = findRefs(snap2, "Send")[0] || findRefs(snap2, "submit")[0];
  if (sendBtn) {
    ab(`click @${sendBtn.ref}`);
  } else {
    ab(`focus @${composer.ref}`);
    ab("press Enter");
  }
  ab("wait 1500");
}

console.log("\n=== After sending message ===");
body = ab('eval "document.body.innerText.slice(0, 800)"').trim();
try { body = JSON.parse(body); } catch {}
console.log(body.slice(0, 800));

ab("screenshot /tmp/shots/03-dm-sent.png --full");
console.log("\n=== Errors ===");
console.log(ab("errors"));
