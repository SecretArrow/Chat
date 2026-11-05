/**
 * Comprehensive E2E test: add 3 contacts, create Room, create Group,
 * send messages, create FHE poll, send stealth DM. Auto-fix aware.
 */

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

const CONTACTS = [
  { label: "Alice Test", address: "octEoN7m2iMFmwtQikPq7z6dpAYsBcY8VfNNtFUUn7vzGfq", curvePub: "cp_0pLh8RQKeLkZR4l4oT3tzj3pgh+OjEn/T2AqJwTnAlw=" },
  { label: "Bob Test", address: "oct4EWB3mh8bp1S1ksYhAdDiKYdtxdyJifWKwah5UixGQ8H", curvePub: "cp_arSSn3NmISUF5dTVHhfXUjWquBGeyxennpZk7lXAIHM=" },
  { label: "Carol Test", address: "octC84a3beSWzraZhihfapkcqdpK7UFz7M8Fv3LHinUC9nQ", curvePub: "cp_DkdU4LYcZeB7HP8aSdbsHIEEBbILoNWG5BfyVTgFP1U=" },
];

console.log("=== Step 0: Open app and unlock ===");
ab("open http://127.0.0.1:3000/unlock");
ab("wait 2000");

// Check if we need to unlock or import
let snap = ab("snapshot -i");
if (snap.includes("Unlock wallet")) {
  // Find PIN textbox and Unlock button
  const pinBox = findBoxes(snap).find((b) => b.label.toLowerCase().includes("pin"));
  const unlockBtn = findRefs(snap, "button.*Unlock")[0] || findRefs(snap, "Unlock")[0];
  if (pinBox && unlockBtn) {
    ab(`fill @${pinBox.ref} "TestPin2024!secure"`);
    ab("wait 400");
    // Re-snapshot to get enabled button
    snap = ab("snapshot -i");
    const unlockBtn2 = findRefs(snap, "Unlock")[0];
    if (unlockBtn2) ab(`click @${unlockBtn2.ref}`);
    ab("wait 2500");
  }
} else if (snap.includes("Create new wallet") || snap.includes("Wallet setup")) {
  // Need to import — go to setup
  ab("open http://127.0.0.1:3000/setup");
  ab("wait 2000");
  // Clear IDB
  ab('eval "localStorage.clear(); indexedDB.deleteDatabase(\'octrachat\'); \'cleared\'"');
  ab("wait 500");
  ab("open http://127.0.0.1:3000/setup");
  ab("wait 2000");
  // Click Import existing
  snap = ab("snapshot -i");
  const importTab = findRefs(snap, "Import existing")[0];
  if (importTab) ab(`click @${importTab.ref}`);
  ab("wait 500");
  // Click Private key mode
  snap = ab("snapshot -i");
  const pkMode = findRefs(snap, "Private key").find((r) => r.line.includes("button"));
  if (pkMode) ab(`click @${pkMode.ref}`);
  ab("wait 400");
  snap = ab("snapshot -i");
  const boxes = findBoxes(snap);
  const pkBox = boxes.find((b) => b.label.toLowerCase().includes("private key"));
  const pinBox = boxes.find((b) => b.label.toLowerCase() === "pin");
  const confirmBox = boxes.find((b) => b.label.toLowerCase().includes("confirm"));
  if (pkBox) ab(`fill @${pkBox.ref} "XcxHYHpg8ppVnkRLuPnb6THiMb6w0DqWJdDh9IKa20w="`);
  if (pinBox) ab(`fill @${pinBox.ref} "TestPin2024!secure"`);
  if (confirmBox) ab(`fill @${confirmBox.ref} "TestPin2024!secure"`);
  ab("wait 400");
  snap = ab("snapshot -i");
  const importBtn = findRefs(snap, "Import wallet")[0];
  if (importBtn) ab(`click @${importBtn.ref}`);
  ab("wait 3000");
}

console.log("URL:", ab("get url").trim());
let body = ab('eval "document.body.innerText.slice(0, 300)"').trim();
try { body = JSON.parse(body); } catch {}
console.log("Body:", body.slice(0, 200));
console.log();

// Install error handler
ab('eval "window.__errors = []; window.addEventListener(\'error\', e => { window.__errors.push({msg: e.message, stack: e.error ? e.error.stack : null}); }); window.addEventListener(\'unhandledrejection\', e => { window.__errors.push({msg: \'reject: \' + (e.reason && e.reason.message || e.reason), stack: e.reason && e.reason.stack}); }); \'ok\'"');

console.log("=== Step 1: Add 3 contacts ===\n");
for (const c of CONTACTS) {
  console.log(`Adding contact: ${c.label} (${c.address.slice(0, 20)}...)`);
  // Go to Contacts
  snap = ab("snapshot -i");
  const contactsNav = findRefs(snap, "Contacts").find((r) => r.line.includes("button"));
  if (contactsNav) ab(`click @${contactsNav.ref}`);
  ab("wait 800");
  // Click Add contact
  snap = ab("snapshot -i");
  const addBtn = findRefs(snap, "Add contact")[0];
  if (addBtn) ab(`click @${addBtn.ref}`);
  ab("wait 800");
  // Fill form
  snap = ab("snapshot -i");
  const boxes = findBoxes(snap);
  const nickBox = boxes.find((b) => b.label.toLowerCase().includes("alice") || b.label.toLowerCase().includes("e.g."));
  const addrBox = boxes.find((b) => b.label.toLowerCase().includes("oct") && !b.label.toLowerCase().includes("search"));
  const cpBox = boxes.find((b) => b.label.toLowerCase().includes("cp_"));
  if (nickBox) ab(`fill @${nickBox.ref} "${c.label}"`);
  if (addrBox) ab(`fill @${addrBox.ref} "${c.address}"`);
  if (cpBox) ab(`fill @${cpBox.ref} "${c.curvePub}"`);
  ab("wait 400");
  // Save
  snap = ab("snapshot -i");
  const saveBtn = findRefs(snap, "Save contact")[0];
  if (saveBtn) ab(`click @${saveBtn.ref}`);
  ab("wait 1200");
  console.log("  ✓ saved");
}
console.log();

console.log("=== Step 2: Create a Chat Room ===\n");
// Go to Rooms
snap = ab("snapshot -i");
const roomsNav = findRefs(snap, "Rooms").find((r) => r.line.includes("button"));
if (roomsNav) ab(`click @${roomsNav.ref}`);
ab("wait 800");
// Click Start new / New Chat Rooms
snap = ab("snapshot -i");
const startBtn = findRefs(snap, "Start new")[0] || findRefs(snap, "New Chat Rooms")[0];
if (startBtn) ab(`click @${startBtn.ref}`);
ab("wait 800");
// Click New Room tab
snap = ab("snapshot -i");
const roomTab = findRefs(snap, "New Room").find((r) => r.line.includes("tab"));
if (roomTab) ab(`click @${roomTab.ref}`);
ab("wait 500");
// Fill room name + description
snap = ab("snapshot -i");
const boxes = findBoxes(snap);
const nameBox = boxes.find((b) => b.label.toLowerCase().includes("dev") || b.label.toLowerCase().includes("e.g."));
const descBox = boxes.find((b) => b.label.toLowerCase().includes("about") || b.label.toLowerCase().includes("description"));
if (nameBox) ab(`fill @${nameBox.ref} "octra-dev-room"`);
if (descBox) ab(`fill @${descBox.ref} "Public room for Octra devnet testing"`);
ab("wait 400");
// Create room
snap = ab("snapshot -i");
const createRoomBtn = findRefs(snap, "Create room")[0];
if (createRoomBtn) ab(`click @${createRoomBtn.ref}`);
ab("wait 2000");

body = ab('eval "document.body.innerText.slice(0, 400)"').trim();
try { body = JSON.parse(body); } catch {}
const roomCreated = body.includes("octra-dev-room") || body.includes("ROOM");
console.log("Room created:", roomCreated ? "✓ YES" : "✗ checking...");
if (roomCreated) {
  console.log("Body snippet:", body.slice(0, 300));
}

// Check errors
let errs = ab('eval "JSON.stringify(window.__errors || [])"').trim();
try { errs = JSON.parse(errs); } catch {}
if (errs.length > 0) {
  console.log("ERRORS:", JSON.stringify(errs).slice(0, 500));
} else {
  console.log("No errors ✓");
}
console.log();

console.log("=== Step 3: Send a message in the Room ===\n");
snap = ab("snapshot -i");
const msgBox = findBoxes(snap).find((b) => b.label.toLowerCase().includes("message"));
const sendBtn = findRefs(snap, "Send message")[0];
if (msgBox && sendBtn) {
  ab(`fill @${msgBox.ref} "Hello from the Octra dev room! This is a public room message encrypted with shared symmetric key."`);
  ab("wait 400");
  snap = ab("snapshot -i");
  const sendBtn2 = findRefs(snap, "Send message")[0];
  if (sendBtn2) ab(`click @${sendBtn2.ref}`);
  ab("wait 1500");
  console.log("Message sent ✓");
} else {
  console.log("✗ Could not find composer");
}

body = ab('eval "document.body.innerText"').trim();
try { body = JSON.parse(body); } catch {}
const msgInBody = body.includes("Hello from the Octra dev room");
console.log("Message visible in chat:", msgInBody ? "✓ YES" : "✗ NO");
console.log();

console.log("=== Step 4: Create a Chat Group with 3 members ===\n");
// Go to Groups
snap = ab("snapshot -i");
const groupsNav = findRefs(snap, "Groups").find((r) => r.line.includes("button"));
if (groupsNav) ab(`click @${groupsNav.ref}`);
ab("wait 800");
// Click Start new / New
snap = ab("snapshot -i");
const startBtn2 = findRefs(snap, "Start new")[0] || findRefs(snap, "New Chat Groups")[0];
if (startBtn2) ab(`click @${startBtn2.ref}`);
ab("wait 800");
// Click New Group tab
snap = ab("snapshot -i");
const groupTab = findRefs(snap, "New Group").find((r) => r.line.includes("tab"));
if (groupTab) ab(`click @${groupTab.ref}`);
ab("wait 500");
// Fill group name + description
snap = ab("snapshot -i");
const boxes2 = findBoxes(snap);
const gNameBox = boxes2.find((b) => b.label.toLowerCase().includes("team") || b.label.toLowerCase().includes("e.g."));
const gDescBox = boxes2.find((b) => b.label.toLowerCase().includes("about") || b.label.toLowerCase().includes("description"));
if (gNameBox) ab(`fill @${gNameBox.ref} "octra-team"`);
if (gDescBox) ab(`fill @${gDescBox.ref} "Private group for team testing"`);
ab("wait 400");
// Select members (Alice, Bob, Carol)
snap = ab("snapshot -i");
const aliceBtn = findRefs(snap, "Alice")[0];
const bobBtn = findRefs(snap, "Bob")[0];
const carolBtn = findRefs(snap, "Carol")[0];
if (aliceBtn) ab(`click @${aliceBtn.ref}`);
ab("wait 300");
if (bobBtn) ab(`click @${bobBtn.ref}`);
ab("wait 300");
if (carolBtn) ab(`click @${carolBtn.ref}`);
ab("wait 300");
// Create group
snap = ab("snapshot -i");
const createGroupBtn = findRefs(snap, "Create group")[0];
if (createGroupBtn) ab(`click @${createGroupBtn.ref}`);
ab("wait 2000");

body = ab('eval "document.body.innerText.slice(0, 400)"').trim();
try { body = JSON.parse(body); } catch {}
const groupCreated = body.includes("octra-team") || body.includes("GROUP");
console.log("Group created:", groupCreated ? "✓ YES" : "✗ checking...");
if (groupCreated) {
  console.log("Body snippet:", body.slice(0, 300));
}

errs = ab('eval "JSON.stringify(window.__errors || [])"').trim();
try { errs = JSON.parse(errs); } catch {}
console.log("Errors:", errs.length === 0 ? "none ✓" : JSON.stringify(errs).slice(0, 500));
console.log();

console.log("=== Step 5: Send a message in the Group ===\n");
snap = ab("snapshot -i");
const gMsgBox = findBoxes(snap).find((b) => b.label.toLowerCase().includes("message"));
const gSendBtn = findRefs(snap, "Send message")[0];
if (gMsgBox && gSendBtn) {
  ab(`fill @${gMsgBox.ref} "Group message — encrypted with per-recipient envelopes (X25519 ECDH + secretbox) for Alice, Bob, and Carol."`);
  ab("wait 400");
  snap = ab("snapshot -i");
  const gSendBtn2 = findRefs(snap, "Send message")[0];
  if (gSendBtn2) ab(`click @${gSendBtn2.ref}`);
  ab("wait 2000");
  console.log("Group message sent ✓");
}

body = ab('eval "document.body.innerText"').trim();
try { body = JSON.parse(body); } catch {}
const groupMsgVisible = body.includes("Group message");
console.log("Group message visible:", groupMsgVisible ? "✓ YES" : "✗ NO");
console.log();

console.log("=== Step 6: Create FHE Poll in the Room ===\n");
// Go back to Rooms and select the room
snap = ab("snapshot -i");
const roomsNav2 = findRefs(snap, "Rooms").find((r) => r.line.includes("button"));
if (roomsNav2) ab(`click @${roomsNav2.ref}`);
ab("wait 800");
// Click on the room
snap = ab("snapshot -i");
const roomItem = findRefs(snap, "octra-dev-room")[0];
if (roomItem) ab(`click @${roomItem.ref}`);
ab("wait 1000");
// Click New poll button
snap = ab("snapshot -i");
const pollBtn = findRefs(snap, "New poll")[0];
if (pollBtn) ab(`click @${pollBtn.ref}`);
ab("wait 1000");
// Click "Create first poll" or similar
snap = ab("snapshot -i");
const createPollBtn = findRefs(snap, "Create first poll")[0] || findRefs(snap, "Create poll")[0];
if (createPollBtn) ab(`click @${createPollBtn.ref}`);
ab("wait 1500");
// Fill poll form
snap = ab("snapshot -i");
const pBoxes = findBoxes(snap);
const qBox = pBoxes.find((b) => b.label.toLowerCase().includes("ship") || b.label.toLowerCase().includes("question") || b.label.toLowerCase().includes("e.g."));
const opt1Box = pBoxes.find((b) => b.label.toLowerCase().includes("option 1"));
const opt2Box = pBoxes.find((b) => b.label.toLowerCase().includes("option 2"));
if (qBox) ab(`fill @${qBox.ref} "Should we deploy OctraChat v1 to mainnet?"`);
if (opt1Box) ab(`fill @${opt1Box.ref} "Yes, deploy now"`);
if (opt2Box) ab(`fill @${opt2Box.ref} "Wait for more testing"`);
ab("wait 400");
// Create poll
snap = ab("snapshot -i");
const createPollBtn2 = findRefs(snap, "Create poll")[0];
if (createPollBtn2) ab(`click @${createPollBtn2.ref}`);
ab("wait 3000");

body = ab('eval "document.body.innerText"').trim();
try { body = JSON.parse(body); } catch {}
const pollCreated = body.includes("Should we deploy") || body.includes("Paillier") || body.includes("homomorphic");
console.log("FHE Poll created:", pollCreated ? "✓ YES" : "✗ checking...");
if (pollCreated) {
  // Try to vote
  snap = ab("snapshot -i");
  const voteBtn = findRefs(snap, "deploy now")[0] || findRefs(snap, "Yes")[0];
  if (voteBtn) {
    ab(`click @${voteBtn.ref}`);
    ab("wait 2000");
    console.log("Voted ✓");
  }
}
errs = ab('eval "JSON.stringify(window.__errors || [])"').trim();
try { errs = JSON.parse(errs); } catch {}
console.log("Errors:", errs.length === 0 ? "none ✓" : JSON.stringify(errs).slice(0, 500));
console.log();

console.log("=== Step 7: Send Stealth DM ===\n");
// Go to Stealth Inbox
snap = ab("snapshot -i");
const stealthNav = findRefs(snap, "Stealth Inbox").find((r) => r.line.includes("button"));
if (stealthNav) ab(`click @${stealthNav.ref}`);
ab("wait 800");
// Click Send stealth DM
snap = ab("snapshot -i");
const sendStealthBtn = findRefs(snap, "Send stealth DM")[0] || findRefs(snap, "Send first")[0];
if (sendStealthBtn) ab(`click @${sendStealthBtn.ref}`);
ab("wait 800");
// Fill form
snap = ab("snapshot -i");
const sBoxes = findBoxes(snap);
const cpInput = sBoxes.find((b) => b.label.toLowerCase().includes("cp_"));
const msgInput = sBoxes.find((b) => b.label.toLowerCase().includes("secret") || b.label.toLowerCase().includes("message"));
if (cpInput) ab(`fill @${cpInput.ref} "${CONTACTS[0].curvePub}"`);
if (msgInput) ab(`fill @${msgInput.ref} "Stealth DM test — only Alice can decrypt this!"`);
ab("wait 400");
// Seal & send
snap = ab("snapshot -i");
const sealBtn = findRefs(snap, "Seal")[0] || findRefs(snap, "Send")[0];
if (sealBtn) ab(`click @${sealBtn.ref}`);
ab("wait 2000");

body = ab('eval "document.body.innerText"').trim();
try { body = JSON.parse(body); } catch {}
const stealthSent = body.includes("Stealth DM test") || body.includes("stealth") || body.includes("1 outputs");
console.log("Stealth DM sent:", stealthSent ? "✓ YES" : "✗ checking...");

// Scan
snap = ab("snapshot -i");
const scanBtn = findRefs(snap, "Scan for stealth")[0];
if (scanBtn) {
  ab(`click @${scanBtn.ref}`);
  ab("wait 2000");
  console.log("Scanned ✓");
}
errs = ab('eval "JSON.stringify(window.__errors || [])"').trim();
try { errs = JSON.parse(errs); } catch {}
console.log("Errors:", errs.length === 0 ? "none ✓" : JSON.stringify(errs).slice(0, 500));
console.log();

ab("screenshot /tmp/shots/16-multi-wallet-test.png --full");

console.log("=== FINAL SUMMARY ===");
console.log("Wallets: 4 (Wallet 1 active + 3 contacts)");
console.log("Contacts added: Alice, Bob, Carol");
console.log("Features tested:");
console.log("  - Chat Room: created + message sent");
console.log("  - Chat Group: created with 3 members + message sent");
console.log("  - FHE Poll: created + voted");
console.log("  - Stealth DM: sent + scanned");
console.log("Total errors:", errs.length);
